CREATE TABLE IF NOT EXISTS demo_workspaces (
    id text PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS demo_members (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    email text NOT NULL,
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'viewer')),
    created_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, email)
);

CREATE INDEX IF NOT EXISTS demo_members_workspace_idx
    ON demo_members (workspace_id, role, name);

CREATE TABLE IF NOT EXISTS demo_projects (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    owner_member_id text,
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    archived_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, owner_member_id)
        REFERENCES demo_members(workspace_id, id)
);

CREATE INDEX IF NOT EXISTS demo_projects_workspace_idx
    ON demo_projects (workspace_id, status, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS demo_documents (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
    project_id text,
    owner_member_id text,
    title text NOT NULL,
    state text NOT NULL CHECK (state IN ('published', 'draft', 'archived')),
    archived_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, project_id)
        REFERENCES demo_projects(workspace_id, id),
    FOREIGN KEY (workspace_id, owner_member_id)
        REFERENCES demo_members(workspace_id, id)
);

CREATE INDEX IF NOT EXISTS demo_documents_workspace_idx
    ON demo_documents (workspace_id, state, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS demo_documents_project_idx
    ON demo_documents (project_id, state);
