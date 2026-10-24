import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import { apiRequest } from '../../desktopBridge';
import { useRace } from '../races/RaceContext';
import type { ImportPreview, Runner } from '../races/types';

export function RegistrationPage() {
  const { race, roster, categories, refreshRaces, refreshSelected, updateRosterRunner, deleteRosterRunner, addCategory, busy } = useRace();
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [message, setMessage] = useState('');
  const [localBusy, setLocalBusy] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [editing, setEditing] = useState<Runner | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editError, setEditError] = useState('');
  if (!race) return null;
  const locked = race.status === 'running' || race.status === 'completed';

  const loadFile = async (file?: File) => {
    if (!file) return;
    try { setCsvText(await file.text()); setPreview(null); setMessage(`${file.name} loaded. Review the preview before applying.`); }
    catch { setMessage('Could not read this CSV file. Try selecting it again.'); }
  };
  const previewImport = async () => {
    if (!csvText.trim()) return;
    setLocalBusy(true);
    try {
      const result = await apiRequest<ImportPreview>(`/api/races/${race.id}/roster/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: csvText }) });
      setPreview(result);
      setMessage('Check the rows below, then apply the import.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not preview this CSV.'); }
    finally { setLocalBusy(false); }
  };
  const applyImport = async () => {
    if (!csvText.trim()) return;
    setLocalBusy(true);
    try {
      const result = await apiRequest<ImportPreview & { applied: boolean }>(`/api/races/${race.id}/roster/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: csvText, commit: true }) });
      setPreview(result);
      setMessage(`Roster saved: ${result.additions} added, ${result.updates} updated.`);
      await refreshSelected(race.id);
      await refreshRaces();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not apply this CSV.'); }
    finally { setLocalBusy(false); }
  };
  const submitCategory = async (event: FormEvent) => {
    event.preventDefault();
    const label = newCategory.trim();
    if (!label) return;
    try { await addCategory(label); setNewCategory(''); }
    catch { /* Race context displays the request error. */ }
  };
  const beginEdit = (runner: Runner) => { setEditing(runner); setEditName(runner.name); setEditCategory(runner.category); setEditError(''); };
  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    try {
      await updateRosterRunner(editing, { name: editName.trim(), category: editCategory });
      setEditing(null);
    } catch (cause) { setEditError(cause instanceof Error ? cause.message : 'Could not update runner.'); }
  };
  const removeRunner = async (runner: Runner) => {
    if (runner.finished) return;
    if (!window.confirm(`Delete ${runner.name} from this race roster?`)) return;
    try { await deleteRosterRunner(runner); }
    catch { /* Race context displays the request error. */ }
  };

  return <section className="workspace">
    <div className="section-heading"><div><h2>Registration</h2><p>Import and manage the runners registered for this race.</p></div><span className="section-count">{roster.length} runners</span></div>
    <div className="registration-grid">
      <section className="panel import-panel"><div className="panel-heading"><div><h3>Import runner data</h3><p>CSV columns: id_key, name, category</p></div><span className="step-label">STEP 1</span></div>
        <label className="file-picker">Choose CSV file<input type="file" accept=".csv,text/csv" onChange={(event) => void loadFile(event.target.files?.[0])} disabled={locked} /></label>
        <textarea className="csv-input" value={csvText} onChange={(event) => { setCsvText(event.target.value); setPreview(null); }} placeholder={'id_key_1, Mark Collins, Men-5k\nid_key_2, Peter Obrien, Men-3k-seniors\nid_key_3, Frank Lou, Women-3k'} disabled={locked} />
        <div className="panel-actions"><button className="button button-secondary" onClick={() => void previewImport()} disabled={!csvText.trim() || localBusy || locked}>{localBusy ? 'Working…' : 'Preview CSV'}</button></div>
        {message && <p className="inline-message" role="status">{message}</p>}
        {preview && <div className="import-preview"><div className="preview-summary"><strong>{preview.records.length} valid rows</strong><span>{preview.additions} new · {preview.updates} updates</span><span>{preview.errors.length} errors</span></div>{preview.errors.length > 0 && <ul className="import-errors">{preview.errors.map((item, index) => <li key={`${item.line}-${index}`}>Line {item.line}: {item.error}</li>)}</ul>}<div className="preview-rows">{preview.records.slice(0, 8).map((item) => <div key={item.idKey}><span>{item.name}</span><span>{item.category}</span></div>)}</div><button className="button button-primary" onClick={() => void applyImport()} disabled={localBusy || !preview.records.length || preview.errors.length > 0}>{localBusy ? 'Saving…' : 'Apply roster'}</button></div>}
      </section>
      <section className="panel roster-panel"><div className="panel-heading roster-heading"><div><h3>Registered runners</h3><p>Names and categories in this race roster.</p></div><span className="step-label">{roster.length}</span></div>
        <form className="category-create" onSubmit={(event) => void submitCategory(event)}><label htmlFor="new-category">Add a category</label><input id="new-category" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="e.g. Men-10k" maxLength={100} disabled={busy} /><button className="button button-secondary" disabled={!newCategory.trim() || busy}><Plus size={14} />Add</button></form>
        {roster.length ? <div className="roster-table"><div className="roster-table-head"><span>NAME</span><span>CATEGORY</span><span>STATUS</span><span>ACTIONS</span></div>{roster.map((runner) => <div className="roster-row" key={runner.idKey}><div><strong>{runner.name}</strong><small>{runner.idKey}</small></div><select value={runner.category} onChange={(event) => void updateRosterRunner(runner, { name: runner.name, category: event.target.value }).catch(() => undefined)} aria-label={`Change ${runner.name} category`} disabled={busy}>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select><span className={runner.finished ? 'finished-label' : 'registered-label'}>{runner.finished ? 'Finished' : 'Registered'}</span><div className="row-actions"><button className="icon-button" onClick={() => beginEdit(runner)} aria-label={`Edit ${runner.name}`} disabled={busy}><Pencil size={14} /></button><button className="icon-button delete-action" onClick={() => void removeRunner(runner)} aria-label={runner.finished ? `${runner.name} must have finish deleted first` : `Delete ${runner.name}`} title={runner.finished ? 'Delete the finish first' : 'Delete runner'} disabled={runner.finished || busy}><Trash2 size={14} /></button></div></div>)}</div> : <div className="empty-state"><Users size={20} /><span>No runners imported yet.</span></div>}
      </section>
    </div>
    {editing && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-roster-runner-title"><div className="dialog-heading"><div><span className="step-label">ROSTER UPDATE</span><h2 id="edit-roster-runner-title">Edit runner</h2></div><button className="icon-button" onClick={() => setEditing(null)} aria-label="Close"><X size={17} /></button></div><form onSubmit={(event) => void saveEdit(event)}><label>Name<input value={editName} onChange={(event) => setEditName(event.target.value)} required maxLength={120} /></label><label>Category<select value={editCategory} onChange={(event) => setEditCategory(event.target.value)} required>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>{editError && <p className="inline-error" role="alert">{editError}</p>}<div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary" disabled={busy}>Save changes</button></div></form></section></div>}
  </section>;
}
