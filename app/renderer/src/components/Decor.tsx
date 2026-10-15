// Print shop marks used as decoration: registration marks and the colour control strip of a press sheet.

export function RegistrationMark({ size = 18, className = '' }: { size?: number, className?: string }) {
    return (
        <svg className={`registration-mark ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.2"/>
            <circle cx="12" cy="12" r="2.6" fill="currentColor"/>
            <path d="M12 0v24M0 12h24" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
    );
}

export function ColorBar({ className = '' }: { className?: string }) {
    return <div className={`color-bar ${className}`} aria-hidden="true"/>;
}
