The PR for issue #$ARGUMENTS has been merged into main.

1. Switch to `main` and `git pull`.
2. If the pull brought new migrations —
   `git diff --name-only ORIG_HEAD HEAD -- packages/midcurve-database/prisma/migrations/`
   — apply them to the dev database:
   `cd packages/midcurve-database && pnpm db:migrate:deploy`.
   Merging a migration does not apply it anywhere. Dev drifts silently
   after every schema change until someone runs `migrate dev` and
   inherits the divergence. Say what was applied, or that there was
   nothing to apply.
3. Delete the feature branch locally (`git branch -d <name>`) and
   on the remote (`git push origin --delete <name>`).
4. Close issue #$ARGUMENTS with a short comment: 2–3 lines
   summarising what was actually delivered, plus a link to the
   merge commit or PR.

Do not touch any other branches or issues.
