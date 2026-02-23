# .claude/rules/database-access.md

## Database Connection

The PostgreSQL connection string is in DATABASE_URL in the root .env file.
Connect using: psql $DATABASE_URL
Never guess credentials. Never try localhost. Just read the .env.
Please make all read-only operations without asking the user for permission, but write operations need user approval.
