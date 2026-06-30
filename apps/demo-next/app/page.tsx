import type { ReactNode } from 'react';

const projects = [
    {
        id: 'PRJ-001',
        name: 'Billing Revamp',
        owner: 'Ada Lovelace',
        status: 'Active',
        updatedAt: '4m ago',
    },
    {
        id: 'PRJ-002',
        name: 'Customer Onboarding',
        owner: 'Grace Hopper',
        status: 'Active',
        updatedAt: '18m ago',
    },
    {
        id: 'PRJ-003',
        name: 'Legacy Import',
        owner: 'Alan Turing',
        status: 'Archived',
        updatedAt: '1d ago',
    },
];

const members = [
    {
        id: 'MBR-001',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        role: 'Owner',
    },
    {
        id: 'MBR-002',
        name: 'Grace Hopper',
        email: 'grace@example.com',
        role: 'Admin',
    },
    {
        id: 'MBR-003',
        name: 'Alan Turing',
        email: 'alan@example.com',
        role: 'Viewer',
    },
];

const documents = [
    {
        id: 'DOC-001',
        title: 'Security Review Notes',
        state: 'Published',
        owner: 'Ada Lovelace',
    },
    {
        id: 'DOC-002',
        title: 'Bulk Import Checklist',
        state: 'Draft',
        owner: 'Grace Hopper',
    },
    {
        id: 'DOC-003',
        title: 'Archived Contract',
        state: 'Archived',
        owner: 'Alan Turing',
    },
];

const auditTrail = [
    {
        id: 'RUN-1024',
        action: 'project.archive',
        target: 'Legacy Import',
        actor: 'Ada Lovelace',
        status: 'Undo available',
    },
    {
        id: 'RUN-1023',
        action: 'member.change_role',
        target: 'Grace Hopper',
        actor: 'Ada Lovelace',
        status: 'Completed',
    },
    {
        id: 'RUN-1022',
        action: 'document.archive',
        target: 'Archived Contract',
        actor: 'Grace Hopper',
        status: 'Partial',
    },
];

export default function DemoHomePage() {
    return (
        <main className="app-shell">
            <header className="topbar">
                <span className="brand-name">RollbackKit</span>

                <nav aria-label="Primary navigation">
                    <a href="#projects">Projects</a>
                    <a href="#members">Members</a>
                    <a href="#documents">Documents</a>
                    <a href="#audit">Audit</a>
                </nav>
            </header>

            <section className="hero">
                <div>
                    <p className="eyebrow">Acme Cloud workspace</p>
                    <h1>Dangerous product actions, made reversible.</h1>
                    <p className="hero-copy">
                        Preview impact, execute safely, preserve an audit trail and undo supported
                        actions before the rollback window expires.
                    </p>
                </div>

                <div className="preview-card">
                    <div className="card-kicker">Action preview</div>
                    <h2>Archive project</h2>
                    <p>
                        This action will archive <strong>Legacy Import</strong>, hide it from active
                        project lists and keep snapshots available for undo.
                    </p>

                    <div className="impact-list">
                        <ImpactItem label="Project visibility changes" tone="warning" />
                        <ImpactItem label="3 documents remain attached" tone="neutral" />
                        <ImpactItem label="Undo available for 30 minutes" tone="success" />
                    </div>
                </div>
            </section>

            <section className="metric-grid" aria-label="Workspace summary">
                <MetricCard label="Projects" value="3" detail="1 archived" />
                <MetricCard label="Members" value="3" detail="2 elevated roles" />
                <MetricCard label="Documents" value="3" detail="1 archived" />
                <MetricCard label="Undo window" value="30m" detail="Default policy" />
            </section>

            <section className="workspace-grid">
                <div className="main-column">
                    <DataPanel
                        id="projects"
                        title="Projects"
                        description="Operations here will demonstrate previewable archive and restore flows."
                    >
                        <DataTable
                            columns={['ID', 'Name', 'Owner', 'Status', 'Updated']}
                            rows={projects.map((project) => [
                                project.id,
                                project.name,
                                project.owner,
                                project.status,
                                project.updatedAt,
                            ])}
                        />
                    </DataPanel>

                    <DataPanel
                        id="members"
                        title="Members"
                        description="Role changes and member removal will use snapshots for undo."
                    >
                        <DataTable
                            columns={['ID', 'Name', 'Email', 'Role']}
                            rows={members.map((member) => [
                                member.id,
                                member.name,
                                member.email,
                                member.role,
                            ])}
                        />
                    </DataPanel>

                    <DataPanel
                        id="documents"
                        title="Documents"
                        description="Document archive actions will demonstrate partial rollback messaging."
                    >
                        <DataTable
                            columns={['ID', 'Title', 'Owner', 'State']}
                            rows={documents.map((document) => [
                                document.id,
                                document.title,
                                document.owner,
                                document.state,
                            ])}
                        />
                    </DataPanel>
                </div>

                <aside className="side-column" id="audit">
                    <DataPanel
                        title="Audit trail"
                        description="Every completed action leaves a durable product-level record."
                    >
                        <div className="audit-list">
                            {auditTrail.map((entry) => (
                                <article className="audit-item" key={entry.id}>
                                    <div>
                                        <code>{entry.action}</code>
                                        <p>{entry.target}</p>
                                    </div>
                                    <span>{entry.status}</span>
                                </article>
                            ))}
                        </div>
                    </DataPanel>

                    <DataPanel
                        title="Undo policy"
                        description="RollbackKit refuses unsafe undo instead of guessing."
                    >
                        <ul className="policy-list">
                            <li>Completed actions can be undone within their configured window.</li>
                            <li>Snapshots stay server-side and are not exposed to the browser.</li>
                            <li>Conflicting state changes block unsafe rollback.</li>
                        </ul>
                    </DataPanel>
                </aside>
            </section>
        </main>
    );
}

interface MetricCardProps {
    readonly label: string;
    readonly value: string;
    readonly detail: string;
}

function MetricCard({ label, value, detail }: MetricCardProps) {
    return (
        <article className="metric-card">
            <span>{label}</span>
            <strong>{value}</strong>
            <p>{detail}</p>
        </article>
    );
}

interface DataPanelProps {
    readonly id?: string;
    readonly title: string;
    readonly description: string;
    readonly children: ReactNode;
}

function DataPanel({ id, title, description, children }: DataPanelProps) {
    return (
        <section className="panel" id={id}>
            <div className="panel-header">
                <div>
                    <h2>{title}</h2>
                    <p>{description}</p>
                </div>
            </div>
            {children}
        </section>
    );
}

interface DataTableProps {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly string[])[];
}

function DataTable({ columns, rows }: DataTableProps) {
    return (
        <div className="table-scroll">
            <table>
                <thead>
                    <tr>
                        {columns.map((column) => (
                            <th key={column}>{column}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.join(':')}>
                            {row.map((cell) => (
                                <td key={cell}>{cell}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

interface ImpactItemProps {
    readonly label: string;
    readonly tone: 'neutral' | 'success' | 'warning';
}

function ImpactItem({ label, tone }: ImpactItemProps) {
    return (
        <div className="impact-item">
            <span className={`impact-dot ${tone}`} aria-hidden="true" />
            <span>{label}</span>
        </div>
    );
}
