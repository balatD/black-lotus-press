import { useEffect, useState } from "react";
import { Copy, Download, Folder, FolderOpen, Images, Save, SlidersHorizontal, Sparkles, Trash } from "lucide-react";
import { DefaultProfile, PlaywrightChannel, type ProcessingProfile } from "../../../../src/model.js";
import { api, errorMessage } from "../api.js";
import { useProgress } from "../useProgress.js";
import { ProgressBar } from "../components/ProgressBar.js";
import { useTasks } from "../useTasks.js";

interface Props {
    profiles: ProcessingProfile[];
    onSaved(): Promise<void>;
}

const UPSCAYL_BINARY = navigator.userAgent.includes('Windows') ? './upscayl/upscayl-bin.exe' : './upscayl/upscayl-bin';

export function ProfilesScreen({ profiles, onSaved }: Props) {
    const [selected, setSelected] = useState(profiles[0]?.name);
    const profile = profiles.find(p => p.name === selected) ?? profiles[0];

    async function createFrom(source: ProcessingProfile) {
        let name = `${source.name} copy`;
        for (let i = 2; profiles.some(p => p.name === name); i++) name = `${source.name} copy ${i}`;
        await api.saveProfile({ ...source, name });
        await onSaved();
        setSelected(name);
    }

    return (
        <>
            <header className="screen-header">
                <h1>Processing profiles</h1>
                <div className="tabs" role="tablist">
                    {profiles.map(p => (
                        <button key={p.name} role="tab" aria-selected={p.name === profile?.name} onClick={() => setSelected(p.name)}><SlidersHorizontal/>{p.name}</button>
                    ))}
                </div>
                <button className="quiet" style={{ marginLeft: 'auto', marginBottom: '0.75rem' }} onClick={() => void createFrom(profile ?? DefaultProfile)}><Copy/>Copy profile</button>
            </header>
            <div className="screen-body">
                {profile && <ProfileForm key={profile.name} profile={profile} canDelete={profiles.length > 1} onSaved={onSaved}/>}
            </div>
        </>
    );
}

function ProfileForm({ profile, canDelete, onSaved }: { profile: ProcessingProfile, canDelete: boolean, onSaved(): Promise<void> }) {
    const [draft, setDraft] = useState(profile);
    const [models, setModels] = useState<string[]>([]);
    const [status, setStatus] = useState<{ message: string, error?: boolean }>();
    const [busy, setBusy] = useState(false);
    const running = useTasks().find(task => task.kind !== 'browser');
    const installing = running?.kind === 'upscayl';
    const progress = useProgress(installing);
    const changed = JSON.stringify(draft) !== JSON.stringify(profile);

    const post = draft.postProcessing;
    const upscaling = draft.upscaling;
    const setPost = (changes: Partial<ProcessingProfile['postProcessing']>) => setDraft({ ...draft, postProcessing: { ...post, ...changes } });
    const setUpscaling = (changes: Partial<ProcessingProfile['upscaling']>) => setDraft({ ...draft, upscaling: { ...upscaling, ...changes } });

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

    const save = () => run(async () => {
        await api.saveProfile(draft);
        await onSaved();
        return 'Saved. Orders keep their settings until you pick the changed profile in their setup.';
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
            <section>
                <h2><Folder/>Files</h2>
                <div className="field">
                    <label htmlFor="output">Orders folder</label>
                    <div className="row">
                        <input id="output" className="grow" value={draft.outputDirectory} onChange={e => setDraft({ ...draft, outputDirectory: e.target.value })}/>
                        <button onClick={() => void chooseOutput()}><FolderOpen/>Choose…</button>
                    </div>
                    <p className="hint">Each order gets a folder here with its card images and PDFs.</p>
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
                    <p className="hint">meinspiel.de asks for 300 dpi. 600 dpi with Upscayl looks sharper; above that a pack gets too big for the 200 MB upload limit.</p>
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

            <div className="row">
                <button className="primary" disabled={busy || !changed} onClick={() => void save()}><Save/>Save profile</button>
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
