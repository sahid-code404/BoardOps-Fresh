# Performance budgets

Phase 00 establishes measurements; concrete thresholds are calibrated after the Phase 02 golden-master port.

Track at minimum:
- initial compressed JavaScript
- largest lazy chunk
- initial API calls
- dashboard query count
- Worker route latency
- D1 query count/latency
- memory after repeated navigation loop
- cumulative layout shift
- long tasks
- animation frame stability

Initial policy budgets: no accidental all-feature initial bundle, no unbounded caches/arrays, no unconditional high-frequency polling, no N+1 query pattern, and no persistent hidden page trees. Any numerical threshold added later must be measured on representative mobile and desktop hardware rather than guessed.
