Van Training Project Rules

Architecture

Mobile first only. Optimize for phone screens.

Keep UI simple and minimal.

No feature bloat.

Build in small layers.

Do not refactor unrelated files when adding features.

Keep logic separated from UI components.

Tech Constraints

React with TypeScript.

No external state management libraries.

Use React local state and props only.

No UI libraries.

No styling frameworks.

Use simple CSS or inline styles.

No unnecessary dependencies.

File Structure

All pages must live in /src/pages.

All reusable components must live in /src/components.

All types must live in /src/types.

All static data must live in /src/data.

Utility functions go in /src/utils.

No new top level folders without explicit instruction.

Data Model

All activity data must follow a structured type.

Each workout submission must be normalized into row format.

Rows must match Google Sheets Master_Log schema exactly.

Do not change schema without explicit instruction.

Activity System

Activity types: Lift, Run, Bike, Swim.

Lift supports split and day selection.

Run, Bike, Swim go directly to metric intake.

Each activity must have its own clean form.

Google Sheets Integration

Use append only logic.

Do not fetch entire sheet on submission.

No read modify write logic.

All credentials must use environment variables.

No secrets in frontend code.

Code Quality

Strict TypeScript types required.

No any type usage.

Keep components under 200 lines.

Keep functions small and focused.

No console logs in production logic.

No placeholder demo code once replaced.

Development Approach

Build one feature at a time.

Do not implement analytics until logging is stable.

Do not implement styling polish before functionality works.

Do not create unused components.

Avoid premature optimization.