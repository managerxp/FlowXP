/*
 * The "Install app" button: Android and desktop Chrome offer a real install prompt, an iPhone needs "Add to Home Screen" (a short how-to opens). It shows only when installing is
 * possible and disappears once the app is installed, so it is never a button that does nothing. Used in the app header and on the public site (`label` is the site's own words).
 */
import { useState } from 'react';
import { useInstall } from '../lib/pwa.js';
import { Button, Modal } from './ui.jsx';

export const InstallButton = ({ label = 'Install app', variant = 'secondary', size = 'sm', className = '' }) => {
  const { canInstall, install, showIosHint } = useInstall();
  const [hint, setHint] = useState(false);
  if (!canInstall && !showIosHint) return null;
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={canInstall ? install : () => setHint(true)}>{label}</Button>
      {hint && (
        <Modal title="Install FlowXP on your iPhone" onClose={() => setHint(false)}>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-700">
            <li>Open this page in <strong>Safari</strong>.</li>
            <li>Tap the <strong>Share</strong> button (the square with an arrow).</li>
            <li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
          </ol>
          <p className="mt-3 text-xs text-ink-500">FlowXP then opens full screen like any app.</p>
        </Modal>
      )}
    </>
  );
};
