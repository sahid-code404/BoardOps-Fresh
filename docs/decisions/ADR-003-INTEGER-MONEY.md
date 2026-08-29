# ADR-003 — Integer money

Status: Accepted.

All authoritative monetary values are stored and transported as integer minor units. For INR, ₹1,250.50 is `125050` paise. Fields use names such as `amount_minor`, `balance_minor`, `tax_minor` and `refund_minor`.

Rationale: the source uses Float/JavaScript-number money in several accounting paths. The rewrite removes binary floating-point ambiguity from accounting truth.
