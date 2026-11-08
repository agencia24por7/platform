type Props = { readonly message?: string; readonly tone: 'error' | 'ok' | 'info' };

export function Feedback({ message, tone }: Props) {
  if (!message) return null;
  return <div className={`alert alert--${tone}`}>{message}</div>;
}
