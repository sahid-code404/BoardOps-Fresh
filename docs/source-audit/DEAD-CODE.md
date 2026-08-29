# Dead code / non-product baggage excluded from target

The source tree contains implementation/runtime baggage that must not be copied wholesale: `.zscripts/`, `agent-ctx/`, `tool-results/`, `backups/`, `db/*.db`, runtime logs, `download/`, ad-hoc uploads, old local server/deployment scripts such as Caddy/keep-alive, mini-services, temporary archives, DFD artifacts, examples/experiments, generated build output and real `.env` files.

This is cleanup of implementation baggage only. Product features represented by messy code are rewritten, not deleted.
