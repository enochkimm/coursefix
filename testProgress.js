import { computeProgress } from './src/ai/progress.js';
import { buildPlan } from './src/ai/planner.js';

const rules = [
  { type: "REQUIRE", label: "Expository Writing", course: { code: "EXPOS-UA 5", credits: { min: 4 } } },
  { type: "REQUIRE", label: "Core Cultures",      course: { code: "CORE-UA 204" } },
  {
    type: "GROUP_SELECT",
    label: "IMA Foundations Electives",
    constraints: { min_credits: 8 },
    options: [
      { code: "IMNY-UT 101" },
      { code: "IMNY-UT 102" },
      { code: "IMNY-UT 103" }
    ]
  }
];

const student = [
  { code: "CORE-UA 204", semester: "Fall 2024" },
  { code: "IMNY-UT 101", semester: "Fall 2024" },
  { code: "IMNY-UT 102", semester: "Fall 2024" }
];

const progress = computeProgress(rules, student);
const plan = buildPlan({
  gaps: progress.gaps,
  alreadyTaken: student,
  constraints: { campus: ["nyc"], credit_load: { target: 16, max: 18 } }
});

console.log(JSON.stringify({ progress: progress.summary, plan }, null, 2));