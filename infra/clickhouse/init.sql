-- GOLI-CLI ClickHouse initialization.
--
-- Creates the langfuse database and tables required by the Langfuse
-- observability stack. Langfuse manages its own schema after initial
-- creation; this script just ensures the database exists.

CREATE DATABASE IF NOT EXISTS langfuse;

-- Grant permissions to the langfuse user.
GRANT ALL PRIVILEGES ON langfuse.* TO langfuse;

-- Langfuse creates its own tables on first boot via migrations.
-- We only need to ensure the database and user exist.
