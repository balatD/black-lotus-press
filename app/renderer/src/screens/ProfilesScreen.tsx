import { type FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, Download, Folder, FolderOpen, Images, RefreshCw, Save, SlidersHorizontal, Sparkles, Trash, X } from "lucide-react";
import { DefaultProfile, isValidOrderName, type Order, PlaywrightChannel, type ProcessingProfile } from "../../../../src/model.js";
import { api, errorMessage } from "../api.js";
import { useProgress } from "../useProgress.js";
import { ProgressBar } from "../components/ProgressBar.js";
import { useTasks } from "../useTasks.js";
import { count } from "../format.js";

interface Props {
    profiles: ProcessingProfile[];
    // The orders of every shop, as any of them can use a profile.
    orders: Order[];
    // The profile shown first.
    start?: string | undefined;
    // The order the screen was opened from, which Back leads to.
    from?: string | undefined;
    onBack(): void;
    onSaved(): Promise<void>;
    onRename(from: string, profile: ProcessingProfile): Promise<void>;
    onUpdateOrders(orders: Order[]): void;
    // Whether the profile on screen has changes that are not saved.
    onUnsaved(unsaved: boolean): void;
}

const UPSCAYL_BINARY = navigator.userAgent.includes('Windows') ? './upscayl/upscayl-bin.exe' : './upscayl/upscayl-bin';

export function ProfilesScreen({ profiles, orders, start, from, onBack, onSaved, onRename, onUpdateOrders, onUnsaved }: Props) {
    const [selected, setSelected] = useState(start ?? profiles[0]?.name);
    const profile = profiles.find(p => p.name === selected) ?? profiles[0];
    const source = profile ?? DefaultProfile;
    // The name of the copy while it is being typed.
    const [copying, setCopying] = useState<string>();
    const [copyError, setCopyError] = useState<string>();
    const copyProblem = copying === undefined ? undefined : profileNameProblem(copying, profiles);
    const unsaved = useRef(false);

    // Another profile on screen drops the changes of this one.
    function mayDrop() {
        return !unsaved.current || window.confirm(`Drop the unsaved changes of the profile "${source.name}"?`);
    }

    function select(name: string) {
        if (name !== profile?.name && mayDrop()) setSelected(name);
    }

    function startCopy() {
        let name = `${source.name} copy`;
        for (let i = 2; profiles.some(p => p.name === name); i++) name = `${source.name} copy ${i}`;
        setCopying(name);
        setCopyError(undefined);
    }

    async function copy(event: FormEvent) {
        event.preventDefault();
        if (copying === undefined || copyProblem || !mayDrop()) return;
        try {
            await api.saveProfile({ ...source, name: copying });
            await onSaved();
            setSelected(copying);
            setCopying(undefined);
        } catch (e) {
            setCopyError(errorMessage(e));
        }
    }

    async function rename(renamed: ProcessingProfile) {
        await onRename(source.name, renamed);
        setSelected(renamed.name);
    }

    return (
        <>
            <header className="screen-header">
                <h1>Processing profiles</h1>
                <div className="tabs" role="tablist">
                    {profiles.map(p => (
                        <button key={p.name} role="tab" aria-selected={p.name === profile?.name} onClick={() => select(p.name)}><SlidersHorizontal/>{p.name}</button>
                    ))}
                </div>
                {copying === undefined ? (
                    <div className="row" style={{ marginLeft: 'auto', marginBottom: '0.75rem' }}>
                        {from !== undefined && <button className="quiet" onClick={onBack}><ArrowLeft/>Back to {from}</button>}
                        <button className="quiet" onClick={startCopy}><Copy/>Copy profile</button>
                    </div>
                ) : (
                    <form className="rename-form" style={{ marginLeft: 'auto' }} onSubmit={e => void copy(e)}>
                        <input autoFocus aria-label="Name of the copy" value={copying} aria-invalid={copyProblem !== undefined}
                               onChange={e => { setCopying(e.target.value); setCopyError(undefined); }}/>
                        <button type="submit" className="primary" disabled={copyProblem !== undefined}><Copy/>Copy</button>
                        <button type="button" className="quiet" onClick={() => setCopying(undefined)}><X/>Cancel</button>
                        {(copyProblem ?? copyError) && <span className="status error">{copyProblem ?? copyError}</span>}
                    </form>
                )}
            </header>
            <div className="screen-body">
                {profile && <ProfileForm key={profile.name} profile={profile} profiles={profiles} orders={orders} canDelete={profiles.length > 1}
                                         onSaved={onSaved} onRename={rename} onUpdateOrders={onUpdateOrders}
                                         onUnsaved={value => { unsaved.current = value; onUnsaved(value); }}/>}
            </div>
        </>
    );
}

// Profile names become file names, which macOS and Windows tell apart without their case.
function profileNameProblem(name: string, profiles: ProcessingProfile[], own?: string) {
    if (!isValidOrderName(name)) return 'Use a name without \\ / : * ? " < > | and without spaces at the ends.';
    return profiles.some(p => p.name !== own && p.name.toLowerCase() === name.toLowerCase()) ? 'A profile with this name exists already.' : undefined;
}

interface FormProps {
    profile: ProcessingProfile;
    profiles: ProcessingProfile[];
    orders: Order[];
    canDelete: boolean;
    onSaved(): Promise<void>;
    onRename(profile: ProcessingProfile): Promise<void>;
    onUpdateOrders(orders: Order[]): void;
    onUnsaved(unsaved: boolean): void;
}

function ProfileForm({ profile, profiles, orders, canDelete, onSaved, onRename, onUpdateOrders, onUnsaved }: FormProps) {
    const [draft, setDraft] = useState(profile);
    const [models, setModels] = useState<string[]>([]);
    const [status, setStatus] = useState<{ message: string, error?: boolean }>();
    const [busy, setBusy] = useState(false);
    const running = useTasks().find(task => task.kind !== 'browser');
    const installing = running?.kind === 'upscayl';
    const progress = useProgress(installing);
    const changed = JSON.stringify(draft) !== JSON.stringify(profile);
    const nameProblem = profileNameProblem(draft.name, profiles, profile.name);
    const outdated = orders.filter(order => order.profile.name === profile.name && JSON.stringify(order.profile) !== JSON.stringify(profile));
    const outdatedNames = outdated.slice(0, 3).map(order => order.name).join(', ') + (outdated.length > 3 ? ` and ${outdated.length - 3} more` : '');

    const post = draft.postProcessing;
    const upscaling = draft.upscaling;
    const setPost = (changes: Partial<ProcessingProfile['postProcessing']>) => setDraft({ ...draft, postProcessing: { ...post, ...changes } });
    const setUpscaling = (changes: Partial<ProcessingProfile['upscaling']>) => setDraft({ ...draft, upscaling: { ...upscaling, ...changes } });

    useEffect(() => onUnsaved(changed), [changed]);
    useEffect(() => () => onUnsaved(false), []);

    useEffect(() => {
        if (!upscaling.modelsDirectory) return;
        api.listUpscaylModels(upscaling.modelsDirectory).then(setModels, () => setModels([]));
    }, [upscaling.modelsDirectory]);

    async function run(work: () => Promise<string>) {
        setBusy(true);
        setStatus(undefined);
        try {
            setStatus({ message: await work() });
        } catch (e) {
            setStatus({ message: errorMessage(e), error: true });
        } finally {
            setBusy(false);
        }
    }

    // A rename shows the profile under its new name, which starts this form anew.
    const save = () => run(async () => {
        if (draft.name !== profile.name) {
            await onRename(draft);
            return '';
        }
        await api.saveProfile(draft);
        await onSaved();
        return 'Saved.';
    });

    const install = () => run(async () => {
        const binaryFile = upscaling.binaryFile ?? UPSCAYL_BINARY;
        const modelsDirectory = upscaling.modelsDirectory ?? './upscayl/models';
        const installed = await api.installUpscayl(binaryFile, modelsDirectory);
        setModels(installed);
        setUpscaling({ enabled: true, binaryFile, modelsDirectory });
        return `Upscayl installed with ${installed.length} models. Save the profile to use it.`;
    });

    const remove = () => run(async () => {
        if (!window.confirm(`Delete the profile "${profile.name}"? Orders that use it keep their settings.`)) return '';
        await api.deleteProfile(profile);
        await onSaved();
        return '';
    });

    async function chooseOutput() {
        const folder = await api.chooseFolder();
        if (folder) setDraft({ ...draft, outputDirectory: folder });
    }

    return (
        <div className="form">
            <div className="field">
                <label htmlFor="profile-name">Name</label>
                <input id="profile-name" value={draft.name} aria-invalid={nameProblem !== undefined} onChange={e => setDraft({ ...draft, name: e.target.value })}/>
                {nameProblem
                    ? <p className="hint"><span className="error">{nameProblem}</span></p>
                    : <p className="hint">Renaming the profile keeps the orders that use it on it.</p>}
            </div>

            <section>
                <h2><Folder/>Files</h2>
                <div className="field">
                    <label htmlFor="output">Orders folder</label>
                    <div className="row">
                        <input id="output" className="grow" value={draft.outputDirectory} onChange={e => setDraft({ ...draft, outputDirectory: e.target.value })}/>
                        <button onClick={() => void chooseOutput()}><FolderOpen/>Choose…</button>
                    </div>
                    <p className="hint">Each order gets a folder here with its card images.</p>
                </div>
                <div className="field">
                    <label htmlFor="browser">Browser</label>
                    <select id="browser" value={draft.playwrightChannel} onChange={e => setDraft({ ...draft, playwrightChannel: e.target.value as PlaywrightChannel })}>
                        <option value={PlaywrightChannel.Chrome}>Google Chrome</option>
                        <option value={PlaywrightChannel.MicrosoftEdge}>Microsoft Edge</option>
                    </select>
                    <p className="hint">Opens Moxfield to load decks and meinspiel.de to upload.</p>
                </div>
            </section>

            <section>
                <h2><Images/>Card images</h2>
                <div className="field">
                    <label htmlFor="dpi">Resolution</label>
                    <div className="row">
                        <input id="dpi" type="number" min={150} max={1200} step={50} value={post.dpi} style={{ width: '7rem' }}
                               onChange={e => setPost({ dpi: Number(e.target.value) })}/>
                        <span className="muted">dpi</span>
                    </div>
                    <p className="hint">The least every card gets: images below it are upscaled, MPC Autofill and own images above it keep theirs for meinspiel.de. meinspiel.de asks for 300 dpi; 600 or 1200 dpi with Upscayl looks sharper, and the larger images take longer to upload.</p>
                </div>
                <div className="field">
                    <label htmlFor="copyright">Copyright line</label>
                    <select id="copyright" value={post.copyrightBehavior} onChange={e => setPost({ copyrightBehavior: e.target.value as typeof post.copyrightBehavior })}>
                        <option value="keep">Keep the original</option>
                        <option value="blur">Blur it</option>
                        <option value="proxy">Blur it and add "Proxy – not for sale"</option>
                        <option value="custom">Blur it and write my own text</option>
                    </select>
                </div>
                {post.copyrightBehavior === 'custom' && (
                    <div className="field">
                        <label htmlFor="copyright-text">Own text</label>
                        <input id="copyright-text" value={post.copyrightText ?? ''} placeholder="Proxy – not for sale" maxLength={60}
                               onChange={e => setPost({ copyrightText: e.target.value })}/>
                        <p className="hint">Printed in white where the copyright line was. Keep it about as long as that line, longer text runs into the card frame.</p>
                    </div>
                )}
                {post.copyrightBehavior !== 'keep' && (
                    <div className="field">
                        <label htmlFor="blur">Blur strength</label>
                        <input id="blur" type="number" min={1} max={50} value={post.blurStrength} style={{ width: '7rem' }} onChange={e => setPost({ blurStrength: Number(e.target.value) })}/>
                    </div>
                )}
                <details>
                    <summary>Advanced</summary>
                    <div className="form" style={{ gap: '0.75rem' }}>
                        <NumberField id="card-width" label="Card width (inches)" value={post.cardWidth} step={0.01} onChange={cardWidth => setPost({ cardWidth })}/>
                        <NumberField id="bleed" label="Bleed (inches)" value={post.bleedWidth} step={0.001} onChange={bleedWidth => setPost({ bleedWidth })}/>
                        <NumberField id="corner" label="Corner radius (share of width)" value={post.cornerRadius} step={0.005} onChange={cornerRadius => setPost({ cornerRadius })}/>
                        <NumberField id="border-crop" label="Border crop (share of width)" value={post.borderCrop} step={0.001} onChange={borderCrop => setPost({ borderCrop })}/>
                    </div>
                </details>
            </section>

            <section>
                <h2><Sparkles/>Upscaling</h2>
                <label className="row">
                    <input type="checkbox" checked={upscaling.enabled} onChange={e => setUpscaling({ enabled: e.target.checked })}/>
                    <span>Upscale the Scryfall scans with Upscayl</span>
                </label>
                {upscaling.enabled && post.dpi <= 300 && (
                    <p className="warning">
                        Upscayl only runs above 300 dpi: the Scryfall scans already have about 300 dpi at card size, so at {post.dpi} dpi there is nothing to enlarge.
                        Set the resolution to 600 dpi to get upscaled, sharper images.
                    </p>
                )}
                {upscaling.enabled && (
                    <>
                        <div className="field">
                            <label htmlFor="binary">Upscayl program</label>
                            <input id="binary" value={upscaling.binaryFile ?? ''} placeholder={UPSCAYL_BINARY} onChange={e => setUpscaling({ binaryFile: e.target.value })}/>
                        </div>
                        <div className="field">
                            <label htmlFor="models">Models folder</label>
                            <input id="models" value={upscaling.modelsDirectory ?? ''} placeholder="./upscayl/models" onChange={e => setUpscaling({ modelsDirectory: e.target.value })}/>
                        </div>
                        <div className="field">
                            <label htmlFor="model">Model</label>
                            <select id="model" value={upscaling.model} onChange={e => setUpscaling({ model: e.target.value })}>
                                {!models.includes(upscaling.model) && <option value={upscaling.model}>{upscaling.model}</option>}
                                {models.map(model => <option key={model} value={model}>{model}</option>)}
                            </select>
                        </div>
                    </>
                )}
                <div className="row">
                    <button disabled={busy || running !== undefined} onClick={() => void install()}><Download/>Install Upscayl</button>
                    <span className="status">Downloads the Upscayl program and its models from GitHub.</span>
                </div>
                {installing && <ProgressBar progress={progress} label="Downloading Upscayl"/>}
            </section>

            {outdated.length > 0 && !changed && (
                <div className="row">
                    <span className="warning">{count(outdated.length, 'order uses', 'orders use')} older settings of this profile: {outdatedNames}.</span>
                    <button disabled={running !== undefined} onClick={() => onUpdateOrders(outdated.map(order => ({ ...order, profile })))}>
                        <RefreshCw/>Update {outdated.length === 1 ? 'it' : 'them'}
                    </button>
                </div>
            )}

            <div className="row">
                <button className="primary" disabled={busy || !changed || nameProblem !== undefined} onClick={() => void save()}><Save/>Save profile</button>
                {canDelete && <button className="quiet danger" disabled={busy} onClick={() => void remove()}><Trash/>Delete profile</button>}
                {status?.message && <span className={`status ${status.error ? 'error' : ''}`}>{status.message}</span>}
            </div>
        </div>
    );
}

function NumberField({ id, label, value, step, onChange }: { id: string, label: string, value: number, step: number, onChange(value: number): void }) {
    return (
        <div className="field">
            <label htmlFor={id}>{label}</label>
            <input id={id} type="number" step={step} value={value} style={{ width: '9rem' }} onChange={e => onChange(Number(e.target.value))}/>
        </div>
    );
}
