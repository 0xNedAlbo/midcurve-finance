---
name: database-research
description: Performs data lookups in the local development database.
allowed-tools: cat, grep, psql
---

# Database Research Skill

## Instructions
Read the .env file in the local sub directory "midcurve-services" and extract hostname:port, username and password from the environment variable DATABASE_URL and connect via psql command to the local database midcurve-dev. Use the database connection to inspect database schema and/or perform SELECT operations on the local database.

## Examples
"Show my all open uniswapv3 postions for user xyz."