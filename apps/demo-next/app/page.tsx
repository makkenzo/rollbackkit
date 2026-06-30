import type { ReactNode } from 'react';

import {
    demoAuditTrail,
    demoDocuments,
    demoMembers,
    demoPreviewImpact,
    demoProjects,
    demoWorkspace,
} from '../lib/demo-data';
import type { DemoPreviewImpact } from '../lib/demo-domain';

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
                    <p className="eyebrow">{demoWorkspace.label}</p>
                    <h1>Dangerous product actions, made reversible.</h1>
                    <p className="hero-copy">{demoWorkspace.description}</p>
                </div>

                <div className="preview-card">
                    <div className="card-kicker">Action preview</div>
                    <h2>Archive project</h2>
                    <p>
                        This action will archive <strong>Legacy Import</strong>, hide it from active
                        project lists and keep snapshots available for undo.
                    </p>

                    <div className="impact-list">
                        {demoPreviewImpact.map((impact) => (
                            <ImpactItem
                                key={impact.label}
                                label={impact.label}
                                tone={impact.tone}
                            />
                        ))}
                    </div>
                </div>
            </section>

            <section className="metric-grid" aria-label="Workspace summary">
                <MetricCard
                    label="Projects"
                    value={String(demoProjects.length)}
                    detail="1 archived"
                />
                <MetricCard
                    label="Members"
                    value={String(demoMembers.length)}
                    detail="2 elevated roles"
                />
                <MetricCard
                    label="Documents"
                    value={String(demoDocuments.length)}
                    detail="1 archived"
                />
                <MetricCard
                    label="Undo window"
                    value={demoWorkspace.undoWindowLabel}
                    detail="Default policy"
                />
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
                            rows={demoProjects.map((project) => [
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
                            rows={demoMembers.map((member) => [
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
                            rows={demoDocuments.map((document) => [
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
                            {demoAuditTrail.map((entry) => (
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

type ImpactItemProps = DemoPreviewImpact;

function ImpactItem({ label, tone }: ImpactItemProps) {
    return (
        <div className="impact-item">
            <span className={`impact-dot ${tone}`} aria-hidden="true" />
            <span>{label}</span>
        </div>
    );
}
