# SMR Defense Site Text and Context

## Current Site Copy

[Navigation]

- SMR Defense
- Fleet
- Assets
- Operations
- Intelligence
- Request Briefing

[Hero]

Eyebrow: Continuous site coverage

Headline: Cover every route. Document every pass. Catch issues early.

Subheadline: SMR Defense deploys and runs robotic fleets for infrastructure sites where staffing, inspections, and documentation cannot keep up with the requirement.

Buttons:
- Request a Briefing
- See Coverage

Hero rail:
- Coverage: Patrol and inspection routes run continuously
- Documentation: Every pass produces a usable site record
- Escalation: Anomalies arrive with location and context
- Burden: No robot headcount or hardware workload

[The Gap]

Headline: The workforce cannot scale to the sites coming online.

Body: Power demand, AI infrastructure, distributed energy, and tighter compliance requirements are forcing operators to monitor more assets, more often, with better proof. At a typical infrastructure site, [INSERT: validated percentage] of assets are unmonitored at any given time. Failures are found after they happen. Security and O&M records live in separate systems. SMR Defense changes that with continuous coverage, unified documentation, and predictive escalation.

Cards:
- Continuous coverage: Routes run on schedule across yards, perimeters, equipment lanes, and hard-to-staff areas.
- Unified documentation: Security, inspection, and maintenance evidence lands in one consistent site record.
- Earlier escalation: Thermal, visual, and route exceptions are flagged before they become outages or findings.

[Field Assets]

Headline: Consistent coverage through terrain crews cannot check often enough.

Body: Ground robots, aerial drones, and fixed sensors work from the same coverage requirement: more frequent checks, better evidence, and fewer blind spots between manual rounds.

Ground robotics:

Headline: Repeatable patrols through difficult site terrain.

Body: Ground robots run documented routes through lanes, stairs, gravel, wet concrete, and equipment corridors that are too irregular for fixed cameras and too frequent for manual walkdowns.

- Consistent perimeter and equipment checks
- Route evidence tied to time and location
- Exceptions escalated with inspection context

Aerial inspection:

Headline: Faster reach across wide and elevated assets.

Body: Drones extend coverage to rooftops, fence lines, overhead equipment, cooling systems, and wide yards when speed, angle, or distance makes ground inspection too slow.

- Rapid visual and thermal sweeps
- Incident views delivered before crews arrive
- Coverage across roofs, yards, and elevated equipment

[Managed Operations]

Headline: Coverage without another fleet to manage.

Body: Your team receives documented patrols, inspection findings, and escalations with context. SMR Defense runs the routes, maintains the equipment, and keeps coverage moving without adding robot operators to your headcount.

- Coverage status without onsite robot staffing
- Maintenance handled before it becomes your burden
- Escalations reviewed before they reach your team

Process:
- Assess the site: Walk the requirement: assets, routes, blind spots, documentation needs, and escalation rules.
- Deploy the fleet: Place the right ground, air, and fixed assets against the routes your site needs covered.
- Operate continuously: Run patrols and inspections on schedule, with exceptions reviewed and routed to the right owner.
- Document outcomes: Deliver records your security, compliance, facilities, and maintenance teams can use.

[Economics]

Headline: Consolidate coverage, documentation, and inspection spend.

Body: Before SMR Defense, coverage is split across staffing, inspection contractors, security vendors, manual reporting, and rising insurance pressure. After deployment, one annual subscription per site covers patrol, inspection, escalation, and documentation.

Cards:
- Before / Labor: Coverage depends on headcount. [INSERT: validated FTE count and fully loaded annual cost] are often required before a site approaches continuous patrol and inspection coverage.
- Before / Vendors: Security and O&M records stay separate. Separate vendors create separate budgets, separate handoffs, and separate records when the site needs one view of what happened.
- Before / Risk: Most assets sit between checks. [INSERT: validated unmonitored asset baseline] of assets are unmonitored at any given time, while insurance premiums continue rising [INSERT: validated annual premium trend].
- After / Subscription: One site coverage budget. A fixed annual subscription consolidates coverage and documentation, with real-time measurement and verification data to support insurance conversations.

[Inspection Intelligence]

Headline: Patrol data becomes maintenance action.

Body: Thermal anomalies are flagged before they become outages. Physical changes are logged before they become compliance findings. Repeat exceptions are tracked across time instead of rediscovered on the next manual round.

Thermal badge: Thermal anomaly detected

Workflow:
- Detect: Robotic patrols capture heat, visual change, route deviation, and site exceptions during scheduled coverage.
- Verify: Operators review the finding, confirm the context, and remove noise before the issue reaches your team.
- Record: The result is saved with location, time, image evidence, and enough history to support the next action.

[Fleet Orchestration]

Headline: One coverage picture across ground, air, and fixed sensing.

Body: Your team should not manage three separate tools. SMR Defense gives the site one coverage view, one escalation stream, and one audit trail across patrol, inspection, and monitoring activity.

Overlay:

Headline: One record for the site.

Body: Ground robots, drones, and fixed sensors cover different parts of the requirement, but the operator receives one record of what was checked, what changed, and what needs action.

Metrics:
- Ground patrol and close inspection
- Aerial scan and incident context
- Fixed sensing and audit trail

[Regulated Environments]

Headline: Built for sites where documentation is not optional.

Body: Infrastructure operators already live with deployment discipline, data handling rules, access controls, and audit expectations. SMR Defense fits into that environment from the start.

Cards:
- Data: Data stays aligned to site requirements. Deployment can support on-premises or private-cloud handling when the site cannot send operational records through open public systems.
- Supply Chain: Procurement questions are addressed early. Supply chain posture, including domestic-first sourcing where required, is handled as part of deployment planning rather than after approval.
- Audit: Coverage produces audit evidence. Routes, inspections, exceptions, and escalations are timestamped so teams can show what happened without rebuilding the record by hand.
- Access: Access follows the site rules. Role-based access and controlled remote operations support sensitive workflows, including NERC CIP-style review where relevant.

[Who We Work With]

Headline: Operators who cannot afford coverage gaps.

Body: SMR Defense fits sites where the monitoring requirement has outgrown the available people, vendor structure, and reporting process.

- Utilities: Substations, switching yards, and generation sites where inspection frequency, perimeter coverage, and outage prevention all matter.
- Data Centers: Campuses where uptime pressure, physical security, power infrastructure, and audit documentation land on the same operations team.
- Industrial: Large facilities with wide perimeters, hard-to-reach equipment, and inspection routes that cannot be checked often enough by manual rounds.
- Government: Sensitive sites where coverage records, access controls, sourcing posture, and response discipline need to hold up under review.

[CTA]

Headline: Tell us about the site.

Body: Share the footprint, assets, routes, documentation requirement, and current coverage model. We will show how continuous coverage maps against your requirement.

Contact paths:
- For operators: I need to map coverage against a real site requirement. Request a site assessment.
- For investors and partners: I want to understand the model and market opportunity. Request a briefing.

[Footer]

- SMR Defense
- Autonomous fleet operations for critical infrastructure.
- 2026

## Technical and Visual Context

The site is a single static HTML file, `SMR Defense.html`, with inline CSS and a small `IntersectionObserver` script for scroll reveals. There is no framework or build step. The local PNG assets live in `uploads/` and are referenced directly by the page.

The image sequence carries the story: substation hero, ground robot, drone inspection, remote operations, thermal anomaly, and full fleet orchestration. The hero uses dark right-side negative space for the headline and CTA while keeping the quadruped visible as proof of real field deployment.

The visual system is restrained: blue-hour infrastructure imagery, graphite surfaces, olive signal accents, amber operational details, and one thermal-orange diagnostic accent. Animations are light fades and short upward reveals. Hero text is immediately visible so the first screen never depends on timing.

Responsive behavior is CSS-only. Desktop uses asymmetric image/text grids. Mobile stacks sections, hides nav links, and turns the hero rail into a compact vertical outcome summary.
