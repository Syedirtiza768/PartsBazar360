# workflow
- Prefers rapid fix→commit→push→deploy→verify iteration cycles with Docker Compose on Ubuntu EC2. Confidence: 0.9
- Expects comprehensive, end-to-end task execution — not superficial patches. When given a large task (e.g., responsive overhaul), expects all screens, states, and edge cases covered in one pass. Confidence: 0.9
- Deploys to Ubuntu EC2 via Docker Compose with SSH key authentication from Windows. Confirms deployments before proceeding. Confidence: 0.85
- After deployments, expects full verification: container health checks, HTTP status codes for all routes, and content spot-checks (e.g., title tags, canonical URLs). Confidence: 0.85
- When monitoring data imports or bulk operations, always show actual data samples (recent entries, titles, rows) alongside the count/percentage — numbers alone are not enough. Confidence: 0.85
- Wants periodic progress polls for long-running jobs with exact ETA calculations (e.g., pages remaining × time/page). Progress updates should include current position, total, percentage, and estimated completion time. Confidence: 0.9
- Prioritizes fixing user-facing bugs (e.g., missing filters, broken UI features) over continuing background tasks (e.g., imports, batch jobs). Will explicitly ask to stop or pause background work so the blocking issue gets fixed, committed, pushed, and deployed first. Confidence: 0.9
