import type { ReactNode } from 'react';
import { demoPreviewImpact } from '../lib/demo-data';
import type { DemoPreviewImpact, DemoProject } from '../lib/demo-domain';
import {
    type DemoActionHistoryEntry,
    getDemoActionHistory,
} from '../lib/server/action-history-repository';
import { getDemoDashboardData } from '../lib/server/demo-repository';
import { ProjectArchiveControl } from './components/project-archive-control';

export const dynamic = 'force-dynamic';

export default async function DemoHomePage() {
    const [dashboard, actionHistory] = await Promise.all([
        getDemoDashboardData(),
        getDemoActionHistory(),
    ]);

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
                    <p className="eyebrow">{dashboard.workspace.label}</p>
                    <h1>Dangerous product actions, made reversible.</h1>
                    <p className="hero-copy">{dashboard.workspace.description}</p>
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
                    value={String(dashboard.projects.length)}
                    detail={`${countArchivedProjects(dashboard.projects)} archived`}
                />
                <MetricCard
                    label="Members"
                    value={String(dashboard.members.length)}
                    detail={`${countElevatedMembers(dashboard.members)} elevated roles`}
                />
                <MetricCard
                    label="Documents"
                    value={String(dashboard.documents.length)}
                    detail={`${countArchivedDocuments(dashboard.documents)} archived`}
                />
                <MetricCard
                    label="Undo window"
                    value={dashboard.workspace.undoWindowLabel}
                    detail="Default policy"
                />
            </section>

            <section className="workspace-grid">
                <div className="main-column">
                    <DataPanel
                        id="projects"
                        title="Projects"
                        description="Operations here demonstrate previewable archive and restore flows."
                    >
                        <ProjectsTable projects={dashboard.projects} />
                    </DataPanel>

                    <DataPanel
                        id="members"
                        title="Members"
                        description="Role changes and member removal use snapshots for undo."
                    >
                        <DataTable
                            columns={['ID', 'Name', 'Email', 'Role']}
                            rows={dashboard.members.map((member) => [
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
                        description="Document archive actions demonstrate partial rollback messaging."
                    >
                        <DataTable
                            columns={['ID', 'Title', 'Owner', 'State']}
                            rows={dashboard.documents.map((document) => [
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
                        <ActionHistoryList entries={actionHistory} />
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

interface ProjectsTableProps {
    readonly projects: readonly DemoProject[];
}

function ProjectsTable({ projects }: ProjectsTableProps) {
    return (
        <div className="table-scroll">
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Owner</th>
                        <th>Status</th>
                        <th>Updated</th>
                        <th>
                            <span className="sr-only">Actions</span>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {projects.map((project) => (
                        <tr key={project.id}>
                            <td>{project.id}</td>
                            <td>{project.name}</td>
                            <td>{project.owner}</td>
                            <td>{project.status}</td>
                            <td>{project.updatedAt}</td>
                            <td className="actions-column">
                                <ProjectArchiveControl
                                    projectId={project.id}
                                    projectName={project.name}
                                    status={project.status}
                                />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
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

interface ActionHistoryListProps {
    readonly entries: readonly DemoActionHistoryEntry[];
}

function ActionHistoryList({ entries }: ActionHistoryListProps) {
    if (entries.length === 0) {
        return <p className="empty-state">No actions recorded yet.</p>;
    }

    return (
        <div className="audit-list">
            {entries.map((entry) => (
                <article className="audit-item" key={entry.id}>
                    <div>
                        <code>{entry.actionName}</code>
                        <p>
                            {entry.targetLabel} · {entry.actorLabel} · {entry.occurredAt}
                        </p>
                    </div>
                    <span className={`status-badge ${entry.statusTone}`}>{entry.statusLabel}</span>
                </article>
            ))}
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

function countArchivedProjects(projects: readonly { readonly status: string }[]): number {
    return projects.filter((project) => project.status === 'Archived').length;
}

function countElevatedMembers(members: readonly { readonly role: string }[]): number {
    return members.filter((member) => member.role === 'Owner' || member.role === 'Admin').length;
}

function countArchivedDocuments(documents: readonly { readonly state: string }[]): number {
    return documents.filter((document) => document.state === 'Archived').length;
}
