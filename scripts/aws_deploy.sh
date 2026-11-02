#!/usr/bin/env bash
# Deploy Cite and Slayy to one EC2 instance (Docker Compose: Caddy HTTPS + Next.js + FastAPI).
#
#   ./scripts/aws_deploy.sh up        create everything (role, key, security group, instance, Elastic IP) and deploy
#   ./scripts/aws_deploy.sh push      copy the current code to the server and rebuild
#   ./scripts/aws_deploy.sh status    show URL, instance state and health
#   ./scripts/aws_deploy.sh logs      tail container logs
#   ./scripts/aws_deploy.sh shell     open a shell on the server (AWS Session Manager; needs the session-manager-plugin)
#   ./scripts/aws_deploy.sh stop|start   stop the instance between demos (keeps disk + IP) / start it again
#   ./scripts/aws_deploy.sh down      delete EVERYTHING this script created
#
# Settings (env vars): REGION (ap-southeast-1), INSTANCE_TYPE (t3.large), BEDROCK_REGION (us-east-1),
#                      BEDROCK_MODEL (moonshotai.kimi-k2.5), SITE_PASSWORD (generated if empty).
# No SSH: code and secrets travel through a private S3 bucket via 1-hour presigned links (objects deleted after
# deploy), and commands run through AWS Systems Manager. Port 22 stays closed. State: .aws-deploy.env (gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."

NAME=cite-and-slayy
REGION=${REGION:-ap-southeast-1}
INSTANCE_TYPE=${INSTANCE_TYPE:-t3.large}
BEDROCK_REGION=${BEDROCK_REGION:-us-east-1}
BEDROCK_MODEL=${BEDROCK_MODEL:-moonshotai.kimi-k2.5}
STATE=.aws-deploy.env
KEY="$HOME/.ssh/$NAME.pem"
ROLE=$NAME-ec2
BUCKET=$NAME-deploy-$(aws sts get-caller-identity --query Account --output text)-$REGION
TAG="ResourceType=%s,Tags=[{Key=Name,Value=$NAME},{Key=project,Value=$NAME}]"

say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
awsr() { aws --region "$REGION" "$@"; }
state_get() { [ -f "$STATE" ] && grep -E "^$1=" "$STATE" | tail -1 | cut -d= -f2- || true; }
state_set() { touch "$STATE"; chmod 600 "$STATE"; grep -v -E "^$1=" "$STATE" > "$STATE.tmp" || true; echo "$1=$2" >> "$STATE.tmp"; mv "$STATE.tmp" "$STATE"; }
ip() { state_get PUBLIC_IP; }
# DOMAIN (in .aws-deploy.env or the environment, e.g. DOMAIN=citeandslayy.com) becomes the main address once its DNS
# A record points at the server; the sslip.io address keeps working alongside it.
domain() { local d; d=${DOMAIN:-$(state_get DOMAIN)}; echo "${d#https://}" | tr -d '/ '; }
site() { local d; d=$(domain); if [ -n "$d" ]; then echo "$d"; else echo "$(ip | tr . -).sslip.io"; fi; }
site_addresses() {   # the custom domain plus the sslip.io fallback
  local d; d=$(domain)
  if [ -z "$d" ]; then site; return; fi
  echo "$d, $(ip | tr . -).sslip.io"
}
www_host() {   # a bare domain also answers on www., which permanently redirects to the bare domain (one canonical site for SEO)
  local d; d=$(domain)
  if [ -n "$d" ] && [ "$(echo "$d" | tr -cd . | wc -c | tr -d ' ')" = 1 ]; then echo "www.$d"; fi
}

create_role() {
  if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then say "IAM role $ROLE exists"; return; fi
  say "Creating IAM role $ROLE (may only call Amazon Bedrock models)"
  aws iam create-role --role-name "$ROLE" --tags Key=project,Value=$NAME \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam put-role-policy --role-name "$ROLE" --policy-name bedrock-invoke --policy-document '{
    "Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":[
      "bedrock:InvokeModel","bedrock:InvokeModelWithResponseStream","bedrock-mantle:CreateInference",
      "aws-marketplace:ViewSubscriptions"],"Resource":"*"}]}'
  aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
  aws iam create-instance-profile --instance-profile-name "$ROLE" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE"
  say "Waiting for IAM to propagate"; sleep 15
}

create_key() {
  if awsr ec2 describe-key-pairs --key-names "$NAME" >/dev/null 2>&1 && [ -f "$KEY" ]; then say "Key pair exists ($KEY)"; return; fi
  awsr ec2 delete-key-pair --key-name "$NAME" >/dev/null 2>&1 || true
  say "Creating SSH key pair → $KEY"
  mkdir -p "$HOME/.ssh"
  awsr ec2 create-key-pair --key-name "$NAME" --query KeyMaterial --output text > "$KEY"
  chmod 400 "$KEY"
}

create_sg() {
  local vpc sg
  vpc=$(awsr ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
  [ "$vpc" = "None" ] && { echo "No default VPC in $REGION"; exit 1; }
  sg=$(awsr ec2 describe-security-groups --filters Name=group-name,Values=$NAME Name=vpc-id,Values="$vpc" --query 'SecurityGroups[0].GroupId' --output text)
  if [ "$sg" = "None" ]; then
    say "Creating security group (HTTP/HTTPS public, SSH only from your IP)"
    sg=$(awsr ec2 create-security-group --group-name $NAME --description "Cite and Slayy web" --vpc-id "$vpc" \
      --tag-specifications "$(printf "$TAG" security-group)" --query GroupId --output text)
    awsr ec2 authorize-security-group-ingress --group-id "$sg" --ip-permissions \
      'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]' \
      'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]' >/dev/null
  fi
  # Port 22 is never opened: all access goes through AWS Systems Manager.
  awsr ec2 revoke-security-group-ingress --group-id "$sg" --ip-permissions "$(awsr ec2 describe-security-groups --group-ids "$sg" \
    --query 'SecurityGroups[0].IpPermissions[?FromPort==`22`]' --output json)" >/dev/null 2>&1 || true
  state_set SG_ID "$sg"
}

launch() {
  if [ -n "$(state_get INSTANCE_ID)" ]; then say "Instance $(state_get INSTANCE_ID) already recorded"; return; fi
  local ami iid alloc
  ami=$(awsr ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)
  cat > /tmp/slayy-userdata.sh <<'EOF'
#!/bin/bash
set -e
curl -fsSL https://get.docker.com | sh
usermod -aG docker ubuntu
apt-get install -y rsync
EOF
  say "Launching $INSTANCE_TYPE in $REGION (Ubuntu 24.04, 30 GB gp3)"
  iid=$(awsr ec2 run-instances --image-id "$ami" --instance-type "$INSTANCE_TYPE" --key-name "$NAME" \
    --security-group-ids "$(state_get SG_ID)" --iam-instance-profile Name="$ROLE" \
    --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=30,VolumeType=gp3,DeleteOnTermination=true}' \
    --metadata-options HttpTokens=required,HttpPutResponseHopLimit=2 \
    --user-data file:///tmp/slayy-userdata.sh \
    --tag-specifications "$(printf "$TAG" instance)" "$(printf "$TAG" volume)" \
    --query 'Instances[0].InstanceId' --output text)
  state_set INSTANCE_ID "$iid"
  say "Waiting for $iid to run"
  awsr ec2 wait instance-running --instance-ids "$iid"
  alloc=$(awsr ec2 allocate-address --domain vpc --tag-specifications "$(printf "$TAG" elastic-ip)" --query AllocationId --output text)
  awsr ec2 associate-address --instance-id "$iid" --allocation-id "$alloc" >/dev/null
  state_set ALLOC_ID "$alloc"
  state_set PUBLIC_IP "$(awsr ec2 describe-addresses --allocation-ids "$alloc" --query 'Addresses[0].PublicIp' --output text)"
  say "Elastic IP: $(ip)"
}

ssm_run() {   # run a shell script on the instance as root via SSM; prints its output; fails if the script fails
  local iid cid st params
  iid=$(state_get INSTANCE_ID)
  params=$(python3 -c 'import json,sys; print(json.dumps({"commands":[sys.stdin.read()],"executionTimeout":["3600"]}))' <<< "$1")
  cid=$(awsr ssm send-command --instance-ids "$iid" --document-name AWS-RunShellScript --timeout-seconds 600 \
        --parameters "$params" --query Command.CommandId --output text)
  while :; do
    sleep 5
    st=$(awsr ssm get-command-invocation --command-id "$cid" --instance-id "$iid" --query Status --output text 2>/dev/null || echo Pending)
    case "$st" in Pending|InProgress|Delayed) ;; *) break ;; esac
  done
  awsr ssm get-command-invocation --command-id "$cid" --instance-id "$iid" --query StandardOutputContent --output text | tail -25
  if [ "$st" != "Success" ]; then
    awsr ssm get-command-invocation --command-id "$cid" --instance-id "$iid" --query StandardErrorContent --output text | tail -25
    echo "Remote step failed ($st)"; return 1
  fi
}

wait_ready() {
  local iid st; iid=$(state_get INSTANCE_ID)
  say "Waiting for the server to register with AWS Systems Manager"
  for _ in $(seq 1 40); do
    st=$(awsr ssm describe-instance-information --filters Key=InstanceIds,Values="$iid" \
         --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)
    [ "$st" = "Online" ] && break; sleep 15
  done
  [ "$st" = "Online" ] || { echo "SSM agent not online; try: $0 reboot"; return 1; }
  ssm_run 'cloud-init status --wait >/dev/null 2>&1 || true; docker version --format "Docker {{.Server.Version}} ready"'
}

write_env_server() {
  local pw; pw=$(state_get SITE_PASSWORD)
  if [ -z "$pw" ]; then
    pw=${SITE_PASSWORD:-$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)}
    state_set SITE_PASSWORD "$pw"
  fi
  local v; local out=.env.server
  : > "$out"; chmod 600 "$out"
  # .env.production (gitignored, server-only values) wins over .env. No owner key is generated: founders come
  # from FOUNDER_ACCOUNTS (password hashes only), so the shared site password never grants admin rights.
  for k in GEMINI_API_KEY CONTACT_EMAIL S2_API_KEY OPENALEX_API_KEY OWNER_EMAILS OWNER_ACCESS_KEY FOUNDER_ACCOUNTS FOUNDER_NAMES AUTH_REQUIRED \
           PUBLIC_URL SUPPORT_EMAIL GOOGLE_CLIENT_ID SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD \
           RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET; do
    v=$(grep -hE "^$k=" .env .env.production 2>/dev/null | tail -1 | cut -d= -f2- || true)
    [ -n "$v" ] && echo "$k=$v" >> "$out"
  done
  # AutoResearchClaw worker: the backend reaches it on the private network with a shared token. The worker's own env
  # file holds only that token and the (non-secret) scholarly API settings.
  local ct; ct=$(state_get CLAW_TOKEN)
  if [ -z "$ct" ]; then ct=$(openssl rand -hex 32); state_set CLAW_TOKEN "$ct"; fi
  printf 'CLAW_URL=http://autoclaw:8100\nCLAW_TOKEN=%s\n' "$ct" >> "$out"
  : > .env.claw; chmod 600 .env.claw
  echo "CLAW_TOKEN=$ct" >> .env.claw
  for k in CONTACT_EMAIL OPENALEX_API_KEY S2_API_KEY; do
    v=$(grep -hE "^$k=" .env .env.production 2>/dev/null | tail -1 | cut -d= -f2- || true)
    [ -n "$v" ] && echo "$k=$v" >> .env.claw
  done
  if grep -q '^AUTH_REQUIRED=true' "$out" && ! grep -q '^PUBLIC_URL=' "$out"; then
    echo "PUBLIC_URL=https://$(site)" >> "$out"
  fi
  cat >> "$out" <<EOF
LLM_PROVIDER=bedrock
BEDROCK_REGION=$BEDROCK_REGION
LLM_MODEL=$BEDROCK_MODEL
LLM_MODEL_FAST=$BEDROCK_MODEL
PREMIUM_MODEL=us.anthropic.claude-opus-4-6-v1
PREMIUM_MODEL_FAST=us.anthropic.claude-haiku-4-5-20251001-v1:0
LLM_FALLBACK=gemini
DEMO_MODE=true
CORS_ORIGINS=https://$(site)
EOF
}

push() {
  [ -n "$(state_get INSTANCE_ID)" ] || { echo "Nothing deployed yet: run '$0 up'"; exit 1; }
  write_env_server
  local tmp; tmp=$(mktemp -d)
  say "Packaging code"
  COPYFILE_DISABLE=1 tar czf "$tmp/code.tgz" \
    --exclude ./.venv --exclude '*/node_modules' --exclude ./frontend/node_modules --exclude '*/.next' --exclude ./var \
    --exclude ./_other_agent --exclude ./.env --exclude ./.env.production --exclude ./.env.server --exclude ./.env.claw --exclude ./.aws-deploy.env --exclude '*.pem' \
    --exclude ./.git --exclude '*/__pycache__' --exclude ./.pytest_cache --exclude '*.egg-info' --exclude ./data-volume \
    --exclude '*.tsbuildinfo' --exclude ./deploy/Caddyfile.generated .
  cp .env.server "$tmp/env.server"
  cp .env.claw "$tmp/env.claw"
  printf '%s' "$(state_get SITE_PASSWORD)" > "$tmp/site_password"
  tar czf "$tmp/secrets.tgz" -C "$tmp" env.server env.claw site_password
  [ -f var/slayy.sqlite3 ] && tar czf "$tmp/data.tgz" -C var slayy.sqlite3 $( [ -d var/documents ] && echo documents )

  if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
    say "Creating private S3 bucket $BUCKET"
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
    aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
      BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  fi
  say "Uploading to s3://$BUCKET (private)"
  local f urls=""
  for f in code secrets data; do
    [ -f "$tmp/$f.tgz" ] || continue
    aws s3 cp "$tmp/$f.tgz" "s3://$BUCKET/$f.tgz" --region "$REGION" --only-show-errors
    urls="$urls $(echo "$f" | tr a-z A-Z)_URL='$(aws s3 presign "s3://$BUCKET/$f.tgz" --region "$REGION" --expires-in 3600)'"
  done
  rm -rf "$tmp"

  say "Deploying on the server (first build ~10 min)"
  ssm_run "set -e
$urls
APP=/home/ubuntu/app; mkdir -p \$APP; cd \$APP
curl -fsSL \"\$CODE_URL\" -o /tmp/code.tgz
find . -mindepth 1 -maxdepth 1 ! -name data-volume -exec rm -rf {} +
tar xzf /tmp/code.tgz && rm -f /tmp/code.tgz
curl -fsSL \"\$SECRETS_URL\" | tar xz -C /tmp
install -m 600 /tmp/env.server .env.server
install -m 600 /tmp/env.claw .env.claw
PW=\$(cat /tmp/site_password); rm -f /tmp/env.server /tmp/env.claw /tmp/site_password
# The AutoResearchClaw container (172.30.0.20) may never reach the instance metadata service (AWS credentials).
# Meanwhile, backend (172.30.0.10) must reach metadata for Amazon Bedrock IAM role credentials.
iptables -D DOCKER-USER -s 172.30.0.10 -d 169.254.169.254 -j ACCEPT 2>/dev/null || true
iptables -D DOCKER-USER -s 172.30.0.0/24 -d 169.254.169.254 -j DROP 2>/dev/null || true
iptables -D DOCKER-USER -s 172.30.0.0/24 -d 169.254.170.2 -j DROP 2>/dev/null || true
iptables -I DOCKER-USER 1 -s 172.30.0.0/24 -d 169.254.170.2 -j DROP
iptables -I DOCKER-USER 1 -s 172.30.0.0/24 -d 169.254.169.254 -j DROP
iptables -I DOCKER-USER 1 -s 172.30.0.10 -d 169.254.169.254 -j ACCEPT
if [ ! -f data-volume/slayy.sqlite3 ] && [ -n \"\${DATA_URL:-}\" ]; then mkdir -p data-volume; curl -fsSL \"\$DATA_URL\" | tar xz -C data-volume; echo 'seeded demo data'; fi
HASH=''; if [ -n \"\$PW\" ] && [ \"\$PW\" != public ]; then HASH=\$(docker run --rm caddy:2 caddy hash-password --plaintext \"\$PW\"); fi   # SITE_PASSWORD=public removes the site-wide password
awk -v site='$(site_addresses)' -v www='$(www_host)' -v apex='$(domain)' -v hash=\"\$HASH\" '{
  if (\$0 ~ /__WWW_REDIRECT__/) { if (www != \"\") { print www \" {\"; print \"\\tredir https://\" apex \"{uri} permanent\"; print \"}\" }; next }
  if (\$0 ~ /__SITE_ADDRESS__/) { sub(/__SITE_ADDRESS__/, site) }
  if (\$0 ~ /__AUTH_BLOCK__/) { if (hash == \"\") next; print \"\\t@gated not path /api/billing/webhook\"; print \"\\tbasic_auth @gated {\"; print \"\\t\\tslayy \" hash; print \"\\t}\"; next }
  print }' deploy/Caddyfile.template > deploy/Caddyfile.generated
docker ps -a --format '{{.Names}}' | grep -E '^[0-9a-f]{12}_deploy-' | xargs -r docker rm -f >/dev/null 2>&1 || true   # stale renamed containers from an interrupted recreate
docker image prune -f >/dev/null 2>&1 || true; docker builder prune -f --filter until=72h >/dev/null 2>&1 || true   # keep disk headroom for image builds
docker compose -f deploy/docker-compose.yml up -d --build --remove-orphans 2>&1 | tail -15
if docker run --rm -v \$PWD/deploy/Caddyfile.generated:/etc/caddy/Caddyfile:ro caddy:2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/tmp/caddy-validate.log 2>&1; then docker compose -f deploy/docker-compose.yml restart caddy 2>&1 | tail -2; else echo 'Caddyfile invalid, keeping the running config:'; tail -5 /tmp/caddy-validate.log; fi
docker compose -f deploy/docker-compose.yml ps --format '{{.Name}}: {{.Status}}'"
  say "Removing uploaded files from S3"
  aws s3 rm "s3://$BUCKET" --recursive --region "$REGION" --only-show-errors
  health
}

health() {
  say "Waiting for https://$(site) to come up (HTTPS certificate on first request)"
  for _ in $(seq 1 60); do
    if out=$(curl -sf -m 10 -u "slayy:$(state_get SITE_PASSWORD)" "https://$(site)/api/health"); then
      echo "$out" | python3 -c "import json,sys; h=json.load(sys.stdin); print('  health ok · AI available:', h['llm'].get('available'))"
      printf '\n\033[1;32m✔ Live: https://%s\033[0m\n  username: slayy\n  password: %s\n' "$(site)" "$(state_get SITE_PASSWORD)"
      return 0
    fi
    sleep 10
  done
  echo "Not healthy yet. Check: $0 logs"; return 1
}

down() {
  local iid alloc sg
  iid=$(state_get INSTANCE_ID); alloc=$(state_get ALLOC_ID); sg=$(state_get SG_ID)
  say "Deleting everything tagged $NAME in $REGION"
  if [ -n "$iid" ]; then awsr ec2 terminate-instances --instance-ids "$iid" >/dev/null; awsr ec2 wait instance-terminated --instance-ids "$iid"; fi
  [ -n "$alloc" ] && awsr ec2 release-address --allocation-id "$alloc" || true
  [ -n "$sg" ] && awsr ec2 delete-security-group --group-id "$sg" || true
  awsr ec2 delete-key-pair --key-name "$NAME" || true
  aws s3 rb "s3://$BUCKET" --force --region "$REGION" 2>/dev/null || true
  aws iam detach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore 2>/dev/null || true
  aws iam remove-role-from-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE" 2>/dev/null || true
  aws iam delete-instance-profile --instance-profile-name "$ROLE" 2>/dev/null || true
  aws iam delete-role-policy --role-name "$ROLE" --policy-name bedrock-invoke 2>/dev/null || true
  aws iam delete-role --role-name "$ROLE" 2>/dev/null || true
  rm -f "$STATE" .env.server; chmod 600 "$KEY" 2>/dev/null && rm -f "$KEY" || true
  say "Done. Nothing from this deployment is left running."
}

case "${1:-help}" in
  up) create_role; create_key; create_sg; launch; wait_ready; push ;;
  push) push ;;
  status) echo "URL: https://$(site)   instance: $(state_get INSTANCE_ID)"
          awsr ec2 describe-instances --instance-ids "$(state_get INSTANCE_ID)" --query 'Reservations[0].Instances[0].State.Name' --output text
          curl -s -m 10 -u "slayy:$(state_get SITE_PASSWORD)" "https://$(site)/api/health" | head -c 300; echo ;;
  logs) ssm_run 'cd /home/ubuntu/app && docker compose -f deploy/docker-compose.yml logs --tail 60 2>&1' ;;
  logs-grep) shift; ssm_run "cd /home/ubuntu/app && docker compose -f deploy/docker-compose.yml logs --tail 5000 backend 2>&1 | grep -iE '$*' | tail -40" ;;
  disk) ssm_run 'df -h / | tail -1; docker system df 2>&1' ;;   # free space on the server and what Docker is using
  prune) ssm_run 'docker builder prune -af 2>&1 | tail -1; docker image prune -af 2>&1 | tail -1; df -h / | tail -1' ;;   # clears build cache and unused images only (never volumes or running containers)
  claw-restart) ssm_run 'cd /home/ubuntu/app && docker compose -f deploy/docker-compose.yml restart autoclaw 2>&1 | tail -3' ;;   # stops any orphaned AutoResearchClaw run
  claw-exec) shift; ssm_run "cd /home/ubuntu/app && docker compose -f deploy/docker-compose.yml exec -T autoclaw $*" ;;   # diagnostics inside the worker
  exec) shift; ssm_run "cd /home/ubuntu/app && docker compose -f deploy/docker-compose.yml exec -T backend $*" ;;   # e.g. exec python -c '...'
  shell) awsr ssm start-session --target "$(state_get INSTANCE_ID)" ;;
  reboot) awsr ec2 reboot-instances --instance-ids "$(state_get INSTANCE_ID)" && say "Rebooting" ;;
  stop) awsr ec2 stop-instances --instance-ids "$(state_get INSTANCE_ID)" >/dev/null && say "Stopped (disk and IP kept; compute billing paused)" ;;
  start) awsr ec2 start-instances --instance-ids "$(state_get INSTANCE_ID)" >/dev/null && awsr ec2 wait instance-running --instance-ids "$(state_get INSTANCE_ID)" && health ;;
  down) down ;;
  *) sed -n '2,13p' "$0" ;;
esac
