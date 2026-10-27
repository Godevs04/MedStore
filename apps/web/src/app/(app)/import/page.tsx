'use client';

import { Icon } from '@/components/icons';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCurrentMembership } from '@/lib/session';
import { toast } from '@/lib/toast';
import { Button, Card, cn, ErrorBanner, Input, PageHeader, Table, Tabs, MetricGroup, StatusBadge } from '@/components/ui';
import { Chip, Dropzone, ResultBar, StatTile, Stepper, SuccessPanel, TypeCard } from './components';
import {
  countOf,
  downloadCsv,
  IMPORT_SPECS,
  MAX_ROWS,
  parseCsv,
  plural,
  templateCsv,
  toCsv,
  type ImportSpec,
  type ImportType,
} from './import-specs';

type RowStatus = 'VALID' | 'ERROR' | 'DUPLICATE';

interface PreviewResult {
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  results: Array<{ row: number; status: RowStatus; errors?: Array<{ field?: string; message: string }>; duplicateOf?: { key: string } }>;
  validatedRows: Array<Record<string, unknown>>;
}

interface CommitResult {
  created: number;
  skipped: number;
  rejected: number;
}

type Filter = 'ALL' | RowStatus;

const STEPS = ['Upload file', 'Check columns', 'Validate', 'Import'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PAGE = 50;
const STATUS_TONE: Record<RowStatus, 'green' | 'red' | 'amber'> = { VALID: 'green', ERROR: 'red', DUPLICATE: 'amber' };
const STATUS_LABEL: Record<RowStatus, string> = { VALID: 'Valid', ERROR: 'Error', DUPLICATE: 'Duplicate' };

function issuesOf(r: PreviewResult['results'][number]): string {
  if (r.status === 'DUPLICATE') return `Already exists: ${r.duplicateOf?.key ?? 'matching record'}`;
  return r.errors?.map((e) => `${e.field ? `${e.field}: ` : ''}${e.message}`).join('; ') ?? '';
}

export default function ImportPage() {
  const membership = useCurrentMembership();
  const can = (spec: ImportSpec) => Boolean(membership && (membership.isOwner || membership.permissions.includes(spec.permission)));

  const [type, setType] = useState<ImportType>('products');
  const [csvText, setCsvText] = useState('');
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(PAGE);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const spec = IMPORT_SPECS[type];
  const parsed = useMemo(() => parseCsv(csvText), [csvText]);

  const columns = useMemo(() => {
    const known = new Set(spec.columns.map((c) => c.key));
    const present = new Set(parsed.headers);
    return {
      recognized: spec.columns.filter((c) => present.has(c.key)),
      missingRequired: spec.columns.filter((c) => c.required && !present.has(c.key)),
      unknown: parsed.headers.filter((h) => !known.has(h)),
    };
  }, [parsed.headers, spec]);

  const hasData = parsed.rows.length > 0;
  const tooMany = parsed.rows.length > MAX_ROWS;
  const columnsOk = hasData && columns.missingRequired.length === 0 && !tooMany;
  const step = result ? 4 : preview ? 3 : columnsOk ? 2 : hasData ? 1 : 0;

  const resetResults = () => {
    setPreview(null);
    setResult(null);
    setConfirming(false);
    setFilter('ALL');
    setSearch('');
    setVisible(PAGE);
    setError(null);
  };

  const startOver = () => {
    resetResults();
    setCsvText('');
    setFile(null);
  };

  const updateText = (text: string) => {
    setCsvText(text);
    resetResults();
  };

  const onFile = (picked: File) => {
    if (!/\.csv$/i.test(picked.name) && picked.type !== 'text/csv') {
      toast.error('Unsupported file', 'Choose a .csv file. In Excel use File → Save As → CSV UTF-8.');
      return;
    }
    if (picked.size > MAX_FILE_BYTES) {
      toast.error('File too large', 'CSV files are limited to 10 MB. Split it into smaller files.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      updateText(String(reader.result ?? ''));
      setFile({ name: picked.name, size: picked.size });
      setPasteOpen(false);
    };
    reader.onerror = () => toast.error('Could not read the file');
    reader.readAsText(picked);
  };

  const previewMutation = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: () => api<PreviewResult>(`/imports/${type}/preview`, { method: 'POST', body: { rows: parsed.rows } }),
    onSuccess: (data) => {
      setPreview(data);
      setFilter(data.errorRows > 0 ? 'ERROR' : data.duplicateRows > 0 ? 'DUPLICATE' : 'ALL');
      if (data.validRows === data.totalRows) toast.success('All rows are valid', `${countOf(data.validRows, spec)} ready to import.`);
      else toast.info('Validation finished', `${data.validRows} valid, ${data.errorRows} with errors, ${data.duplicateRows} duplicates.`);
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Validation failed. Check your connection and try again.'),
  });

  const commitMutation = useMutation({
    meta: { success: 'Import complete', silentError: true },
    mutationFn: (rows: Array<Record<string, unknown>>) =>
      api<CommitResult>(`/imports/${type}/commit`, { method: 'POST', body: { validatedRows: rows } }),
    onSuccess: (r) => {
      setResult(r);
      setConfirming(false);
    },
    onError: (e) => {
      setConfirming(false);
      setError(e instanceof ApiClientError ? e.message : 'Import failed. No rows were saved.');
    },
  });

  const filteredRows = useMemo(() => {
    if (!preview) return [];
    const term = search.trim().toLowerCase();
    return preview.results.filter((r) => {
      if (filter !== 'ALL' && r.status !== filter) return false;
      if (!term) return true;
      const source = parsed.rows[r.row - 1] ?? {};
      return Object.values(source).some((v) => v.toLowerCase().includes(term)) || issuesOf(r).toLowerCase().includes(term);
    });
  }, [preview, filter, search, parsed.rows]);

  const downloadErrorReport = () => {
    if (!preview) return;
    const problems = preview.results.filter((r) => r.status !== 'VALID');
    const headers = [...parsed.headers, 'importStatus', 'importIssues'];
    const rows = problems.map((r) => {
      const source = parsed.rows[r.row - 1] ?? {};
      return [...parsed.headers.map((h) => source[h] ?? ''), STATUS_LABEL[r.status], issuesOf(r)];
    });
    downloadCsv(`${type}-import-issues.csv`, toCsv(headers, rows));
    toast.success('Issue report downloaded', 'Fix the rows, delete the two import columns and upload again.');
  };

  const sampleRows = parsed.rows.slice(0, 5);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Import data"
        subtitle="Bulk-load products, vendors and customers from CSV. Every row is validated on the server before anything is saved."
        actions={
          <Button variant="secondary" onClick={() => downloadCsv(`medicore-${type}-template.csv`, templateCsv(spec))}>
            <Icon name="download" size={14} /> {spec.title} template
          </Button>
        }
      />

      <Card>
        <Stepper steps={STEPS} current={step} />
      </Card>

      {result ? (
        <SuccessPanel spec={spec} result={result} onAgain={startOver} />
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted">1 · What are you importing?</h2>
            <div role="radiogroup" aria-label="Import type" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {Object.values(IMPORT_SPECS).map((s) => (
                <TypeCard
                  key={s.type}
                  spec={s}
                  selected={s.type === type}
                  allowed={can(s)}
                  onSelect={() => {
                    if (s.type === type) return;
                    setType(s.type);
                    resetResults();
                  }}
                />
              ))}
            </div>
          </section>

          <Card
            title={`2 · Upload your ${spec.title.toLowerCase()} file`}
            actions={
              <button
                type="button"
                onClick={() => setGuideOpen((o) => !o)}
                className="text-xs font-medium text-teal-ink transition-colors hover:text-brand-deep"
                aria-expanded={guideOpen}
              >
                {guideOpen ? 'Hide column guide' : 'Column guide'}
                <Icon name="chevronDown" size={13} className={cn('ml-1 transition-transform duration-300', guideOpen && 'rotate-180')} />
              </button>
            }
          >
            <div className="space-y-4">
              <div className="mc-collapse" data-open={guideOpen}>
                <div>
                  <div className="mb-1 overflow-hidden rounded-lg border border-line">
                    <Table
                      head={
                        <tr>
                          <th className="px-3 py-2">Column</th>
                          <th className="px-3 py-2">Rules</th>
                          <th className="px-3 py-2">Example</th>
                        </tr>
                      }
                    >
                      {spec.columns.map((c) => (
                        <tr key={c.key} className="text-xs">
                          <td className="whitespace-nowrap px-3 py-1.5">
                            <code className="font-mono text-ink">{c.key}</code>
                            {c.required ? <span className="ml-1.5 text-[10px] font-semibold uppercase text-danger">required</span> : null}
                          </td>
                          <td className="px-3 py-1.5 text-neutral-600">{c.hint || c.label}</td>
                          <td className="px-3 py-1.5 font-mono text-muted">{c.example || '—'}</td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                </div>
              </div>

              <Dropzone
                file={file}
                rowCount={parsed.rows.length}
                invalid={hasData && !columnsOk}
                onFile={onFile}
                onClear={startOver}
              />

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setPasteOpen((o) => !o)}
                    className="text-xs font-medium text-neutral-600 transition-colors hover:text-teal-ink"
                    aria-expanded={pasteOpen}
                  >
                    <Icon name="chevronRight" size={13} className={cn('mr-1 transition-transform duration-300', pasteOpen && 'rotate-90')} />
                    Paste CSV text instead
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      updateText(templateCsv(spec));
                      setPasteOpen(true);
                    }}
                    className="text-xs font-medium text-teal-ink transition-colors hover:text-brand-deep"
                  >
                    Load sample row
                  </button>
                </div>
                <div className="mc-collapse mt-2" data-open={pasteOpen}>
                  <div>
                    <textarea
                      className="h-36 w-full rounded-md border border-neutral-300 bg-surface p-3 font-mono text-xs transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
                      placeholder={`${spec.columns.map((c) => c.key).join(',')}\n${spec.columns.map((c) => c.example).join(',')}`}
                      value={csvText}
                      onChange={(e) => {
                        setFile(null);
                        updateText(e.target.value);
                      }}
                    />
                  </div>
                </div>
              </div>

              {hasData ? (
                <div className="mc-anim-fade-in space-y-3 rounded-lg border border-line bg-subtle/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">Column check</p>
                    <p className="text-xs text-muted">
                      {columns.recognized.length} of {spec.columns.length} columns recognized
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {columns.missingRequired.map((c) => (
                      <Chip key={c.key} tone="red" title="Required column is missing">
                        <Icon name="close" size={11} strokeWidth={2.5} /> {c.key}
                      </Chip>
                    ))}
                    {columns.recognized.map((c) => (
                      <Chip key={c.key} tone="green" title={c.label}>
                        <Icon name="check" size={13} strokeWidth={2.5} /> {c.key}
                      </Chip>
                    ))}
                    {columns.unknown.map((h) => (
                      <Chip key={h} tone="amber" title="Not a known column; it will be ignored">
                        ? {h}
                      </Chip>
                    ))}
                  </div>
                  {columns.missingRequired.length > 0 ? (
                    <p className="text-xs text-danger">
                      Add the missing required {columns.missingRequired.length === 1 ? 'column' : 'columns'} to the header row, or download the template.
                    </p>
                  ) : null}
                  {columns.unknown.length > 0 ? (
                    <p className="text-xs text-warning">Unrecognized columns are ignored. Column names are case-sensitive.</p>
                  ) : null}
                  {tooMany ? (
                    <p className="text-xs text-danger">
                      This file has {parsed.rows.length.toLocaleString('en-IN')} rows; the limit is {MAX_ROWS.toLocaleString('en-IN')} per import. Split the file.
                    </p>
                  ) : null}

                  {columns.recognized.length > 0 ? (
                    <div className="overflow-hidden rounded-lg border border-line bg-surface">
                      <p className="border-b border-line px-3 py-1.5 text-2xs text-muted">
                        First {sampleRows.length} of {parsed.rows.length.toLocaleString('en-IN')} rows
                      </p>
                      <div className="max-h-56 overflow-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="sticky top-0 bg-subtle text-[10px] uppercase tracking-wider text-muted">
                            <tr>
                              <th className="px-2 py-1.5">#</th>
                              {columns.recognized.map((c) => (
                                <th key={c.key} className="whitespace-nowrap px-2 py-1.5">
                                  {c.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {sampleRows.map((row, i) => (
                              <tr key={i}>
                                <td className="px-2 py-1.5 text-faint">{i + 1}</td>
                                {columns.recognized.map((c) => (
                                  <td key={c.key} className="max-w-[12rem] truncate whitespace-nowrap px-2 py-1.5 text-neutral-700">
                                    {row[c.key] || <span className="text-neutral-300">—</span>}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {error ? <ErrorBanner>{error}</ErrorBanner> : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={!columnsOk || previewMutation.isPending} onClick={() => { setError(null); previewMutation.mutate(); }}>
                  {previewMutation.isPending ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Validating {plural(parsed.rows.length, 'row')}…
                    </>
                  ) : preview ? (
                    'Re-validate'
                  ) : hasData ? (
                    `Validate ${plural(parsed.rows.length, 'row')}`
                  ) : (
                    'Validate rows'
                  )}
                </Button>
                {hasData ? (
                  <Button variant="ghost" onClick={startOver}>
                    Clear
                  </Button>
                ) : (
                  <span className="text-xs text-muted">Nothing is saved until you confirm the import.</span>
                )}
              </div>
              {previewMutation.isPending ? (
                <div className="h-1 overflow-hidden rounded-full bg-brand-100" role="progressbar" aria-label="Validating">
                  <div className="mc-progress-stripes h-full w-full rounded-full bg-accent" />
                </div>
              ) : null}
            </div>
          </Card>

          {preview ? (
            <Card title="3 · Review validation results">
              <div className="space-y-4">
                <MetricGroup columns={4}>
                  <StatTile label="Total rows" value={preview.totalRows} tone="neutral" />
                  <StatTile label="Ready to import" value={preview.validRows} tone="green" />
                  <StatTile label="Errors" value={preview.errorRows} tone="red" />
                  <StatTile label="Duplicates" value={preview.duplicateRows} tone="amber" />
                </MetricGroup>
                <ResultBar valid={preview.validRows} errors={preview.errorRows} duplicates={preview.duplicateRows} />

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Tabs<Filter>
                    value={filter}
                    onChange={(f) => {
                      setFilter(f);
                      setVisible(PAGE);
                    }}
                    tabs={[
                      { id: 'ALL', label: 'All', count: preview.totalRows },
                      { id: 'VALID', label: 'Valid', count: preview.validRows },
                      { id: 'ERROR', label: 'Errors', count: preview.errorRows },
                      { id: 'DUPLICATE', label: 'Duplicates', count: preview.duplicateRows },
                    ]}
                  />
                  <div className="w-full sm:w-64">
                    <Input
                      placeholder="Search rows or issues…"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setVisible(PAGE);
                      }}
                    />
                  </div>
                </div>

                {filteredRows.length === 0 ? (
                  <p className="mc-anim-fade-in rounded-lg border border-dashed border-line py-8 text-center text-sm text-muted">
                    No rows match this filter.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-line">
                    <Table
                      head={
                        <tr>
                          <th className="px-3 py-2">Row</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">{spec.columns.find((c) => c.key === spec.identity[0])?.label}</th>
                          <th className="px-3 py-2">{spec.columns.find((c) => c.key === spec.identity[1])?.label}</th>
                          <th className="px-3 py-2">Issues</th>
                        </tr>
                      }
                    >
                      {filteredRows.slice(0, visible).map((r) => {
                        const source = parsed.rows[r.row - 1] ?? {};
                        return (
                          <tr
                            key={r.row}
                            className={cn('transition-colors hover:bg-subtle/60', r.status === 'ERROR' && 'bg-danger/[0.04]')}
                          >
                            <td className="px-3 py-2 num text-muted">{r.row + 1}</td>
                            <td className="px-3 py-2">
                              <StatusBadge status={r.status} label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
                            </td>
                            <td className="max-w-[10rem] truncate px-3 py-2 font-medium text-ink">{source[spec.identity[0]] || '—'}</td>
                            <td className="max-w-[12rem] truncate px-3 py-2 text-neutral-600">{source[spec.identity[1]] || '—'}</td>
                            <td className="px-3 py-2 text-xs">
                              {r.status === 'ERROR' ? (
                                <ul className="space-y-0.5">
                                  {r.errors?.map((e, j) => (
                                    <li key={j} className="text-danger">
                                      {e.field ? <code className="mr-1 rounded bg-danger/10 px-1 font-mono text-[10px]">{e.field}</code> : null}
                                      {e.message}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <span className={r.status === 'DUPLICATE' ? 'text-warning' : 'text-faint'}>
                                  {r.status === 'DUPLICATE' ? issuesOf(r) : 'Ready'}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </Table>
                    {filteredRows.length > visible ? (
                      <div className="border-t border-line p-2 text-center">
                        <Button variant="ghost" onClick={() => setVisible((v) => v + PAGE)}>
                          Show {Math.min(PAGE, filteredRows.length - visible)} more of {(filteredRows.length - visible).toLocaleString('en-IN')} remaining
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
                <p className="text-2xs text-faint">Row numbers match your spreadsheet (the header is row 1).</p>
              </div>
            </Card>
          ) : null}

          {preview ? (
            <Card title="4 · Import">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-neutral-600">
                  {preview.validRows > 0 ? (
                    <>
                      <span className="font-semibold text-ink">{countOf(preview.validRows, spec)}</span>{' '}
                      will be created.
                      {preview.errorRows + preview.duplicateRows > 0
                        ? ` ${plural(preview.errorRows + preview.duplicateRows, 'row')} with issues will be skipped.`
                        : ''}
                    </>
                  ) : (
                    'No valid rows to import. Download the issue report, fix the rows and upload again.'
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {preview.errorRows + preview.duplicateRows > 0 ? (
                    <Button variant="secondary" onClick={downloadErrorReport}>
                      <Icon name="download" size={14} /> Issue report
                    </Button>
                  ) : null}
                  {confirming ? (
                    <span className="mc-anim-fade-in flex items-center gap-2 rounded-lg border border-line bg-subtle px-2 py-1">
                      <span className="text-xs font-medium text-ink">Create {plural(preview.validRows, 'record')}?</span>
                      <Button disabled={commitMutation.isPending} onClick={() => commitMutation.mutate(preview.validatedRows)}>
                        {commitMutation.isPending ? 'Importing…' : 'Yes, import'}
                      </Button>
                      <Button variant="ghost" disabled={commitMutation.isPending} onClick={() => setConfirming(false)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button disabled={preview.validRows === 0} onClick={() => setConfirming(true)}>
                      Import {countOf(preview.validRows, spec)}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
