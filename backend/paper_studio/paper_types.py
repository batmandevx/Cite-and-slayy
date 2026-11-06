"""Paper types: each topic gets the structure its field expects instead of one 'theory monograph' template.

  method     a technical paper proposing a method/architecture with formal analysis (CS, engineering, applied maths)
  empirical  an empirical study: design, data, measures and analysis plan; reports real results only when the user
             supplies data (health, social science, education, business, natural sciences)
  review     a literature review: documented search, thematic synthesis, conflicting evidence, research agenda
  position   a conceptual / policy paper: background, argument, counterarguments, recommendations

Every section has a `stage`. Sections in the same stage are written in parallel; a later stage sees the paper memory of
everything written before it. Foundations (formulation, methods) come first, the Introduction comes last, as human
authors do. Requirements are content checklists rather than word counts, so writers add substance instead of filler.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

PaperType = Literal["method", "empirical", "review", "position"]

TYPE_LABEL = {
    "method": "Technical method paper", "empirical": "Empirical study", "review": "Literature review", "position": "Position / policy paper",
}

ANALYSIS_TOKENS = ("Place the tokens [[FIG:trend]], [[TABLE:trend]], [[FIG:years]], [[FIG:impact]] and [[FIG:venues]] each on its own "
                   "line at the point where it is discussed.")
BIBLIO = ("Report and interpret ONLY the bibliometric measurements in FACTS (never invent numbers): the 10-year publication "
          "trajectory (the current year is partial), the age profile of the cited corpus, citation concentration between "
          "foundational and recent works, and the venue distribution. Say what each pattern means for the research question. "
          "Do not build your own tables or charts of these counts: the tokens below insert them. ")


@dataclass
class Spec:
    key: str
    heading: str
    task: str
    stage: int
    design: bool = False            # proposes a design: numbers here are parameters, not results (skipped by the number guard)
    needs_data: bool = False        # only when the user supplied a dataset
    skip_with_data: bool = False    # replaced by the data-driven section when the user supplied a dataset


@dataclass
class TypePlan:
    key: PaperType
    sections: list[Spec]
    analysis_key: str               # where the bibliometric figures go
    refs_table_key: str             # where [[TABLE:refs]] goes
    protocol_heading: str = ""      # gets the workflow diagram and the pilot experiments before it
    experiments: bool = False       # run the pilot benchmark + toy simulation
    architect: str = ""             # what the architect must design for this type
    extra: list[str] = field(default_factory=list)

    def active(self, has_data: bool) -> list[Spec]:
        return [s for s in self.sections if (has_data or not s.needs_data) and not (has_data and s.skip_with_data)]


METHOD = TypePlan(
    key="method", analysis_key="analysis", refs_table_key="related", protocol_heading="Experimental Setup and Ablation Protocol",
    experiments=True,
    architect=("a named method with an acronym, formal assumptions A1-A3, one analytical property derivable from them, and the "
               "regime where they break down"),
    sections=[
        Spec("intro", "Introduction", stage=5, task=(
            "Must contain: the concrete technical bottleneck and how existing approaches fail (cited); the research question; "
            "the proposed method by name and acronym, previewed in two or three sentences consistent with the Method section in "
            "PAPER MEMORY; reference to the literature trajectory (Fig. 1); a numbered list of exactly the contributions in "
            "CONTRIBUTIONS; one closing paragraph on the paper's organisation. Do not restate details already given later.")),
        Spec("related", "Background and Related Work", stage=3, task=(
            "Must contain: 3 ## subsections, one per technical paradigm, that COMPARE works (assumptions, mechanisms, limitations) "
            "instead of summarising them one by one; a short ## Where the evidence disagrees subsection built from the "
            "CONFLICTS in the dossier (skip it if there are none); the token [[TABLE:refs]] on its own line; a table preceded by "
            "'Table: Qualitative positioning of the proposed framework against representative prior paradigms' comparing 4 prior "
            "method families (cited) and the proposed method on 5 concrete properties with Yes/Partial/No; a final paragraph "
            "naming the exact gap this paper addresses.")),
        Spec("formulation", "Problem Formulation and System Model", stage=1, design=True, task=(
            "Must contain: the mathematical setting, input/output spaces, the operational model and the objective in 2-3 display "
            "equations ($$...$$) with every symbol defined in prose; **Assumption A1**-**A3** stated precisely, plus what is NOT "
            "assumed; a table preceded by 'Table: Summary of mathematical notation' (| Symbol | Domain / Space | Meaning |) that "
            "covers every symbol. Later sections will reuse this notation exactly.")),
        Spec("method", "Proposed Method", stage=2, design=True, task=(
            "Must contain: 2-3 ## subsections, one per module, each with its display equations and the intuition and edge-case "
            "behaviour of every term, using ONLY the notation in PAPER MEMORY (introduce new symbols explicitly); a Mermaid "
            "architecture diagram preceded by 'Figure: Architecture of the proposed framework' ('flowchart LR', 6-8 nodes, "
            "single-letter ids, plain words inside [ ] or { }); an **Algorithm 1:** block with **Input:**, **Parameters:**, "
            "numbered steps and **Output:**; a table preceded by 'Table: Per-step time and memory complexity by module'.")),
        Spec("theory", "Theoretical and Formal Analysis", stage=3, design=True, task=(
            "Must contain: **Proposition 1**, **Lemma 1** and **Theorem 1** stated formally under Assumptions A1-A3, each "
            "followed by '*Proof Sketch.*' with valid steps in $$...$$ ending with $\\square$; **Proposition 2 (Boundary "
            "Condition and Failure Regime)** showing how guarantees degrade when an assumption fails. Every step must follow "
            "from stated definitions; if a step needs an extra condition, state it as an assumption. No empirical claims.")),
        Spec("analysis", "Quantitative Literature and Bibliometric Synthesis", stage=3, task=BIBLIO + ANALYSIS_TOKENS),
        Spec("protocol", "Experimental Setup and Ablation Protocol", stage=3, design=True, task=(
            "Must contain: hypotheses **H1**-**H3** that are falsifiable; development vs held-out test split rules that prevent "
            "leakage; datasets (named only if a cited abstract names them, otherwise their required domain and scale); baselines "
            "from the cited references; primary and diagnostic metrics with equations; paired non-parametric testing with "
            "Holm-Bonferroni correction; a Mermaid 'flowchart TD' preceded by 'Figure: Leak-free evaluation and ablation "
            "workflow'; 'Table: Component ablation matrix'; 'Table: Planned benchmark comparison' whose unrun cells read "
            "'to be measured'.")),
        Spec("results", "Experiments on Real Data", stage=3, needs_data=True, task="Report ONLY the numbers in DATA ANALYSIS (FACTS), in this order: the analysed sample (N, units, period, coverage and missingness), descriptive statistics, then each hypothesis or comparison with its estimate, uncertainty (95% CI, SE or sd across folds) and p-value where reported, then the robustness check. Place [[DATA:tables]] and [[DATA:figures]] each on its own line where they are discussed. State null or mixed results plainly. Use associational language for observational data. Interpretation belongs in the Discussion."),
        Spec("discussion", "Discussion, Failure Modes and Limitations", stage=4, task=(
            "Must contain: ## Failure Modes and Operational Mitigations (concrete scenarios tied to Proposition 2); ## Threats to "
            "Validity (internal, external, construct, bibliographic coverage, and that the full benchmark is planned rather than "
            "run); ## Broader Impact and Deployment Considerations; then a top-level '# Conclusion' of 1-2 paragraphs that "
            "answers the research question without repeating the abstract.")),
    ],
)

EMPIRICAL = TypePlan(
    key="empirical", analysis_key="analysis", refs_table_key="related",
    architect="a precise research question, 2-3 testable hypotheses, the study design, population/data, key measures and analysis plan",
    sections=[
        Spec("intro", "Introduction", stage=4, task=(
            "Must contain: why the problem matters (cited); what is known and the specific gap; the research question and "
            "hypotheses **H1**-**H3** exactly as in the outline; a numbered list of the contributions; a short roadmap. "
            "Keep it consistent with the Methods in PAPER MEMORY.")),
        Spec("related", "Literature Review", stage=2, task=(
            "Must contain: 2-3 ## thematic subsections that synthesise findings across studies (agreement, effect directions, "
            "populations, designs, quality of evidence) rather than summarising papers one at a time; a ## Conflicting findings "
            "subsection from the CONFLICTS in the dossier with possible explanations (population, measures, design); the token "
            "[[TABLE:refs]] on its own line; a closing paragraph stating the gap this study fills.")),
        Spec("analysis", "Evidence Base and Bibliometric Overview", stage=2, task=BIBLIO + ANALYSIS_TOKENS),
        Spec("methods", "Methods", stage=1, design=True, task=(
            "Must contain ## subsections: Study Design; Participants or Data (inclusion/exclusion, sampling, and a sample-size "
            "rationale written as a formula or procedure, not an invented number, unless DATA ANALYSIS gives the real N); Measures (each construct, its validated "
            "instrument if a cited abstract names one, and how it is scored); Procedure; Statistical Analysis (models, "
            "covariates, estimator and software-agnostic estimation details such as priors, convergence criteria or bootstrap "
            "settings where relevant, handling of missing data, multiple-comparison correction, robustness checks); Ethics. If USER DATA "
            "ANALYSIS is in FACTS, describe that actual dataset and the analyses that were run instead of a plan. Include a "
            "table preceded by 'Table: Variables, measures and hypotheses' mapping each variable to its measure and hypothesis. "
            "If DATA ANALYSIS is in FACTS, this is a secondary analysis of that dataset: describe its source, coverage, "
            "variables and the models that were actually run.")),
        Spec("results", "Results", stage=2, needs_data=True, task="Report ONLY the numbers in DATA ANALYSIS (FACTS), in this order: the analysed sample (N, units, period, coverage and missingness), descriptive statistics, then each hypothesis or comparison with its estimate, uncertainty (95% CI, SE or sd across folds) and p-value where reported, then the robustness check. Place [[DATA:tables]] and [[DATA:figures]] each on its own line where they are discussed. State null or mixed results plainly. Use associational language for observational data. Interpretation belongs in the Discussion."),
        Spec("discussion", "Discussion", stage=3, task=(
            "Must contain: ## Interpretation (what the results imply for each hypothesis; if no data was analysed, what "
            "outcomes would support or refute each hypothesis); ## Comparison with Prior Work (cited, including conflicting "
            "studies); ## Implications; ## Limitations (design, measurement, generalisability, and that the study is proposed "
            "if no data was analysed); ## Future Work; then a top-level '# Conclusion' of 1-2 paragraphs.")),
    ],
)

REVIEW = TypePlan(
    key="review", analysis_key="analysis", refs_table_key="themes",
    architect="2-3 review questions, 3-4 themes that organise the literature, and the review's contributions",
    sections=[
        Spec("intro", "Introduction", stage=3, task=(
            "Must contain: scope and why a review is needed now (cite the growth in Fig. 1); review questions **RQ1**-**RQ3** "
            "exactly as in the outline; how this review differs from earlier reviews in the corpus, if any; a numbered list of "
            "contributions; a roadmap.")),
        Spec("methods", "Review Methodology", stage=1, task=(
            "Describe the ACTUAL search that produced this review, using only FACTS: the databases queried, the search queries, "
            "the number of records retrieved, screened and included, retraction screening and exclusions, citation snowballing, "
            "and the relevance ranking. State inclusion and exclusion criteria and the thematic synthesis approach. Include a "
            "Mermaid 'flowchart TD' preceded by 'Figure: Study identification and selection flow' whose node labels contain the "
            "counts from FACTS (plain words and numbers only). Never claim a formal PRISMA protocol or registration.")),
        Spec("analysis", "Bibliometric Overview", stage=1, task=BIBLIO + ANALYSIS_TOKENS),
        Spec("themes", "Thematic Synthesis", stage=2, task=(
            "Must contain one ## subsection per THEME in the outline. In each: what the studies find, where they agree, the "
            "strength and type of evidence (designs, populations, scale as stated in abstracts), and gaps, citing densely and "
            "comparing studies against each other. Place the token [[TABLE:refs]] on its own line in the first subsection. End "
            "with a table preceded by 'Table: Summary of evidence by theme' (| Theme | Key findings | Evidence base | Open gaps |).")),
        Spec("conflicts", "Conflicting Evidence and Open Questions", stage=2, task=(
            "Build this section from the CONFLICTS in the dossier: for each disagreement, state both positions with citations "
            "and the most likely explanations (populations, measures, designs, time periods). Then list the open questions the "
            "literature cannot yet answer. If the dossier lists no conflicts, discuss tensions and uncertainties instead.")),
        Spec("results", "Quantitative Evidence from Open Data", stage=2, needs_data=True, task="Report ONLY the numbers in DATA ANALYSIS (FACTS), in this order: the analysed sample (N, units, period, coverage and missingness), descriptive statistics, then each hypothesis or comparison with its estimate, uncertainty (95% CI, SE or sd across folds) and p-value where reported, then the robustness check. Place [[DATA:tables]] and [[DATA:figures]] each on its own line where they are discussed. State null or mixed results plainly. Use associational language for observational data. Interpretation belongs in the Discussion."),
        Spec("agenda", "Research Agenda and Recommendations", stage=3, task=(
            "Must contain: a prioritised research agenda (3-5 items, each tied to a gap or conflict above and a study design "
            "that would resolve it); recommendations for practitioners or policy where the evidence supports them; limitations "
            "of this review (database coverage, abstract-level screening, automated search); then a top-level '# Conclusion' "
            "answering each review question in turn.")),
    ],
)

POSITION = TypePlan(
    key="position", analysis_key="analysis", refs_table_key="background",
    architect="a clear thesis, 3 supporting claims with the evidence for each, and the strongest counterarguments",
    sections=[
        Spec("intro", "Introduction", stage=3, task=(
            "Must contain: the issue and why it matters now (cited); the thesis stated in one sentence; the three claims that "
            "support it; a numbered list of contributions; a roadmap.")),
        Spec("background", "Background", stage=1, task=(
            "Must contain: the key concepts and definitions, the current state of practice and policy, and the main positions "
            "in the debate with citations. Place the token [[TABLE:refs]] on its own line.")),
        Spec("analysis", "Landscape of the Literature", stage=1, task=BIBLIO + ANALYSIS_TOKENS),
        Spec("argument", "Analysis and Argument", stage=2, task=(
            "Must contain one ## subsection per CLAIM in the outline: the claim, the evidence for it (cited, with the strength "
            "of that evidence), and the reasoning that links evidence to thesis. Distinguish evidence from inference.")),
        Spec("results", "Evidence from Open Data", stage=2, needs_data=True, task="Report ONLY the numbers in DATA ANALYSIS (FACTS), in this order: the analysed sample (N, units, period, coverage and missingness), descriptive statistics, then each hypothesis or comparison with its estimate, uncertainty (95% CI, SE or sd across folds) and p-value where reported, then the robustness check. Place [[DATA:tables]] and [[DATA:figures]] each on its own line where they are discussed. State null or mixed results plainly. Use associational language for observational data. Interpretation belongs in the Discussion."),
        Spec("counter", "Counterarguments and Limitations", stage=2, task=(
            "Must contain the strongest counterarguments, each stated fairly with citations (use the CONFLICTS in the dossier), "
            "followed by a reasoned response or a concession; then the limits of the argument.")),
        Spec("implications", "Implications and Recommendations", stage=3, task=(
            "Must contain concrete recommendations for researchers, practitioners and policymakers, each tied to the argument "
            "above, and what evidence would change the thesis; then a top-level '# Conclusion'.")),
    ],
)

PLANS: dict[str, TypePlan] = {"method": METHOD, "empirical": EMPIRICAL, "review": REVIEW, "position": POSITION}

CLASSIFY_HINT = (
    "method: proposes a new algorithm, model, architecture or system (computer science, engineering, applied mathematics). "
    "empirical: asks a question answered by collecting or analysing data about people, organisations or nature (health, "
    "psychology, education, economics, social science, biology, environment). review: the user wants an overview, survey, "
    "state of the art, or 'benefits and risks' of a field. position: argues for a policy, ethical stance or conceptual view.")
