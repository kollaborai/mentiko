# mentiko repo boundary policy

## public repo boundary

This repo is open source. Every file that lands here should make sense
for someone self-hosting Mentiko on their own infrastructure.

keep here:
  - app code in bin/, lib/, web/
  - app docs for chains, agents, API routes, and runtime behavior
  - generic self-hoster docs for backup, restore, security, and incidents
  - schemas, types, tests, and CI workflows
  - example configs with placeholders only

do not add:
  - real infrastructure addresses, hostnames, SSH users, or resource IDs
  - deployment runbooks or operator commands tied to a real environment
  - customer, tenant, billing, support, or incident details
  - credentials, tokens, webhook URLs, admin URLs, or secret names tied to
    a real environment

when unsure, stop and ask whether the file belongs in a public
self-hosted product repo.
