// =============================================================================
// ELIGIBILITY DICTIONARY — the founder's rulebook, verbatim in spirit.
//
// "If a CV comes with any words like this, it is eligible." This module is
// the safety net UNDER the AI: the model formats the profile and argues the
// route, but a CV whose text matches this dictionary can never be marked
// not-eligible — a cybersecurity engineer was once bounced by a too-narrow
// prompt, and that costs real clients. The net catches what the model drops.
//
// Families are ordered: the first family that matches names the route and
// industry. Short acronyms (AI, ML, IT, SRE…) are matched CASE-SENSITIVELY
// with word boundaries so "it" in a sentence never counts; everything else
// is case-insensitive.
// =============================================================================

export interface KeywordVerdict {
  eligible: boolean;
  route: string | null;
  industry: string | null;
  matched: string[];
}

interface Family {
  route: string;
  industry: string;
  /** Case-insensitive phrase patterns. */
  loose: RegExp[];
  /** Case-sensitive acronym patterns (word-bounded). */
  strict?: RegExp[];
}

const F = (s: string) => new RegExp(`\\b${s}\\b`, 'i');
const S = (s: string) => new RegExp(`\\b${s}\\b`); // case-sensitive

const FAMILIES: Family[] = [
  {
    route: 'Research & Academia', industry: 'research',
    loose: [
      F('researcher'), F('research (?:scientist|fellow|associate|engineer|professor|director)'),
      F('principal investigator'), F('post-?doc(?:toral)?'), F('doctorate'), F('doctoral'),
      F('ph\\.?\\s?d\\.?'), F('professor'), F('lecturer'), F('research and development'),
      F('scientific research'), F('publications?'), F('patent(?:s| holder)?'), F('inventor'),
      F('principal scientist'), F('senior scientist'), F('distinguished engineer'),
      F('technical fellow'), F('staff engineer'), F('principal engineer'),
    ],
    strict: [S('R&D'), S('PhD')],
  },
  {
    route: 'Digital Technology — AI & Data', industry: 'tech',
    loose: [
      F('artificial intelligence'), F('machine learning'), F('deep learning'),
      F('natural language processing'), F('computer vision'), F('generative ai'),
      F('large language models?'), F('reinforcement learning'), F('neural networks?'),
      F('ai (?:engineer|researcher|scientist|safety|ethics|infrastructure|product)'),
      F('data scien(?:ce|tist)'), F('data engineer(?:ing)?'), F('data analyst'),
      F('data architect'), F('big data'), F('data mining'), F('business intelligence'),
      F('quantitative (?:analyst|researcher|finance|developer)'), F('predictive analytics'),
      F('decision science'), F('data visuali[sz]ation'), F('tensorflow'), F('pytorch'),
      F('scikit-?learn'), F('keras'), F('opencv'),
    ],
    strict: [S('AI'), S('ML'), S('NLP'), S('LLMs?'), S('GenAI'), S('MLOps'), S('BI')],
  },
  {
    route: 'Digital Technology — Cybersecurity', industry: 'tech',
    loose: [
      F('cyber\\s?security'), F('information security'), F('security (?:engineer|architect|analyst|operations|engineering)'),
      F('threat (?:intelligence|research|analyst)'), F('incident response'), F('digital forensics'),
      F('network security'), F('cloud security'), F('application security'),
      F('penetration test(?:ing|er)?'), F('ethical hacking'), F('vulnerability research'),
      F('identity and access management'), F('cryptograph(?:y|er)'), F('zero trust'),
      F('malware'), F('privacy engineering'), F('cyber defen[cs]e'),
    ],
    strict: [S('SOC'), S('IAM'), S('CISO'), S('DevSecOps')],
  },
  {
    route: 'Digital Technology — Software & Cloud', industry: 'tech',
    loose: [
      F('software (?:engineer(?:ing)?|developer|development|architect)'),
      F('full[ -]?stack'), F('back[ -]?end'), F('front[ -]?end'), F('web developer'),
      F('mobile (?:developer|engineer)'), F('application developer'), F('systems? engineer'),
      F('information technology'), F('computer science'), F('computer engineering'),
      F('solutions? architect'), F('technical architect'), F('enterprise architect'),
      F('cloud (?:engineer|architect|computing)'), F('platform engineer(?:ing)?'),
      F('infrastructure engineer(?:ing)?'), F('site reliability'), F('devops'),
      F('data(?:base)? engineer'), F('network engineer'), F('systems? administrator'),
      F('technical lead'), F('engineering manager'), F('head of (?:engineering|technology)'),
      F('vp,? engineering'), F('technology director'), F('kubernetes'), F('docker'),
      F('terraform'), F('infrastructure as code'), F('serverless'), F('distributed systems'),
      F('edge computing'), F('microservices'), F('amazon web services'), F('microsoft azure'),
      F('google cloud'), F('data structures'), F('operating systems'),
      F('compiler'), F('embedded (?:software|systems?|engineer(?:ing)?)'), F('firmware'),
      F('api development'), F('high performance computing'), F('parallel computing'),
      F('quantum computing'), F('python'), F('java(?:script)?'), F('typescript'),
      F('c\\+\\+'), F('c#'), F('golang'), F('kotlin'),
      F('postgres(?:ql)?'), F('mongodb'), F('hadoop'), F('apache spark'), F('pyspark'), F('kafka'),
      F('snowflake'), F('databricks'), F('salesforce'), F('ci/cd'), F('github'),
    ],
    strict: [
      S('CTO'), S('CIO'), S('SRE'), S('AWS'), S('GCP'), S('SQL'),
      S('MATLAB'), S('SAP'), S('VP Engineering'),
    ],
  },
  {
    route: 'Digital Technology — FinTech & Blockchain', industry: 'finance',
    loose: [
      F('fin-?tech'), F('financial technology'), F('digital banking'), F('digital payments?'),
      F('payment (?:technology|systems?)'), F('open banking'), F('embedded finance'),
      F('reg-?tech'), F('insur-?tech'), F('wealth-?tech'), F('lending technology'),
      F('algorithmic trading'), F('computational finance'), F('financial engineering'),
      F('risk technology'), F('fraud detection'), F('anti-?money laundering'),
      F('blockchain'), F('distributed ledger'), F('smart contracts?'), F('web3'),
      F('decentrali[sz]ed finance'), F('tokeni[sz]ation'), F('digital assets'),
      F('ethereum'), F('cryptocurrenc(?:y|ies)'), F('consensus algorithms?'),
      F('quant (?:developer|researcher)'),
    ],
    strict: [S('DeFi'), S('DLT'), S('AML')],
  },
  {
    route: 'Digital Technology — Deep Tech & Hardware', industry: 'tech',
    loose: [
      F('robotics'), F('autonomous (?:systems|vehicles)'), F('self-driving'),
      F('drones?'), F('unmanned systems'), F('human-robot interaction'),
      F('internet of things'), F('digital twins?'), F('industry 4\\.0'),
      F('extended reality'), F('augmented reality'), F('virtual reality'), F('metaverse'),
      F('telecommunications?'), F('telecom'), F('wireless communications?'),
      F('mobile networks'), F('radio frequency'), F('satellite communications?'),
      F('optical communications?'), F('fib(?:er|re) optics?'), F('signal processing'),
      F('semiconductors?'), F('chip design'), F('microelectronics'),
      F('hardware engineer(?:ing)?'), F('processor design'), F('silicon'),
    ],
    strict: [
      S('IoT'), S('UAV'), S('VR'), S('XR'), S('5G'), S('6G'), S('RF'),
      S('VLSI'), S('ASIC'), S('FPGA'), S('GPU'), S('CPU'),
    ],
  },
  {
    route: 'Digital Technology — Bio, Health & Climate', industry: 'healthcare',
    loose: [
      F('bioinformatics'), F('computational biology'), F('biotechnolog(?:y|ist)'),
      F('biomedical (?:engineer(?:ing)?|research)'), F('health-?tech'), F('digital health'),
      F('medical technology'), F('med-?tech'), F('computational medicine'), F('genomics?'),
      F('medical ai'), F('pharmaceutical technology'), F('drug discovery'),
      F('computational chemistry'), F('renewable energy'), F('solar technology'),
      F('wind energy'), F('battery technology'), F('energy storage'), F('electric vehicles?'),
      F('hydrogen technology'), F('clean(?:\\s|-)?tech(?:nology)?'), F('climate-?tech(?:nology)?'),
      F('green technology'), F('carbon (?:technology|capture)'), F('smart grids?'),
      F('sustainable (?:technology|engineering)'),
    ],
    strict: [S('EV')],
  },
  {
    route: 'Engineering & Technology', industry: 'engineering',
    loose: [
      F('mechanical engineer(?:ing)?'), F('electrical engineer(?:ing)?'),
      F('electronic(?:s)? engineer(?:ing)?'), F('electronics and communication'),
      F('civil engineer(?:ing)?'), F('structural engineer(?:ing)?'),
      F('chemical engineer(?:ing)?'), F('aerospace engineer(?:ing)?'),
      F('aeronautical engineer(?:ing)?'), F('automotive engineer(?:ing)?'),
      F('mechatronics'), F('industrial engineer(?:ing)?'), F('manufacturing engineer(?:ing)?'),
      F('production engineer(?:ing)?'), F('materials engineer(?:ing)?'),
      F('environmental engineer(?:ing)?'), F('energy engineer(?:ing)?'),
      F('petroleum engineer(?:ing)?'), F('nuclear engineer(?:ing)?'),
      F('marine engineer(?:ing)?'), F('instrumentation engineer(?:ing)?'),
      F('control engineer(?:ing)?'), F('engineering (?:research|technology)'),
      F('b\\.?\\s?tech'), F('m\\.?\\s?tech'),
    ],
    strict: [S('ECE')],
  },
];

/**
 * Scan CV text against the founder's dictionary. Field beats title: ANY match
 * makes the candidate eligible; the first matching family names the route.
 */
export function keywordEligibility(text: string): KeywordVerdict {
  const t = text || '';
  if (t.trim().length < 40) return { eligible: false, route: null, industry: null, matched: [] };

  const matched: string[] = [];
  let route: string | null = null;
  let industry: string | null = null;

  for (const fam of FAMILIES) {
    let famHit = false;
    for (const re of fam.loose) {
      const m = t.match(re);
      if (m) { famHit = true; if (matched.length < 12) matched.push(m[0]); }
    }
    for (const re of fam.strict ?? []) {
      const m = t.match(re);
      if (m) { famHit = true; if (matched.length < 12) matched.push(m[0]); }
    }
    if (famHit && !route) { route = fam.route; industry = fam.industry; }
  }

  return { eligible: matched.length > 0, route, industry, matched };
}

/**
 * The same dictionary, summarised for the AI prompt — so the model reasons
 * WITH the rulebook instead of being corrected by it afterwards.
 */
export const ELIGIBILITY_PROMPT_BLOCK = `
MIGRIZO ELIGIBILITY RULEBOOK (binding — match FIELD, not job title):
A candidate is ELIGIBLE if their profession, education, research, publications, technical work or leadership touches ANY of:
- Software & IT: software/full-stack/backend/frontend/mobile development, computer science, systems, solutions/enterprise architecture, cloud (AWS/Azure/GCP), Kubernetes/Docker/Terraform, DevOps/SRE/platform/infrastructure, databases, networks, embedded/firmware, APIs, HPC, quantum computing, engineering leadership (CTO/CIO/VP/Head of Engineering).
- AI & Data: AI/ML/deep learning, NLP, computer vision, GenAI/LLMs, reinforcement learning, AI safety/ethics, data science/engineering/analytics, BI, quantitative analysis/research, predictive analytics.
- Cybersecurity: security engineering/architecture/analysis, SOC, incident response, forensics, threat intelligence, pen testing, ethical hacking, IAM, cryptography, zero trust, malware research, privacy engineering, CISO.
- FinTech & Blockchain: digital banking/payments, open banking, RegTech/InsurTech/WealthTech, algorithmic trading, quant finance, fraud/AML tech, blockchain/DLT/smart contracts/Web3/DeFi.
- Deep tech & hardware: robotics, autonomous systems/vehicles, drones, IoT, digital twins, AR/VR/XR, telecoms/5G/6G/RF/satellite/fibre, semiconductors/VLSI/ASIC/FPGA/chip design, hardware.
- Bio/Health/Climate tech: bioinformatics, computational biology, biotech, biomedical engineering, HealthTech/MedTech, genomics, medical AI, drug discovery, renewable energy, batteries/EV, hydrogen, CleanTech/ClimateTech, smart grids, carbon capture.
- ALL classical engineering: mechanical, electrical, electronics/ECE, civil, structural, chemical, aerospace, automotive, mechatronics, industrial, manufacturing, materials, environmental, energy, petroleum, nuclear, marine, instrumentation, control, B.Tech/M.Tech/BE/ME.
- Research & academia: researchers, scientists, postdocs, PhD holders/candidates, professors/lecturers, principal investigators, R&D, publications, patents, inventors, senior/staff/principal/distinguished engineers, fellows.
Technical skills alone count as signals: Python, Java, C++, C#, JS/TS, Go, Rust, SQL, R, MATLAB, TensorFlow, PyTorch, Kubernetes, Docker, AWS/Azure/GCP, Spark, Kafka, Salesforce, SAP, CI/CD, MLOps.
Include related, interdisciplinary, specialist, senior, academic and leadership variants. When genuinely uncertain, LEAN ELIGIBLE — a wrong rejection costs a real client; an optimistic yes is reviewed by a human consultant on the call anyway.
NOT eligible (unless they also show any field above): pure sales/retail/hospitality/admin/driving/manual roles with no technical, research or engineering dimension.`;
