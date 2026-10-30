/*
 * Warn before leaving a form with changes that were not saved. `useDirty(value)` says whether the form differs from how it was when it loaded
 * (and from the last save: call clean() after a successful save). `useUnsavedWarning(dirty)` then asks before an in-app link is followed and
 * lets the browser ask before the tab is closed or reloaded.
 *
 * The app uses a plain BrowserRouter (no data router), so links are caught on the click rather than with a router blocker. The browser's back
 * button is not caught; closing, reloading and every link inside FlowXP are.
 */
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDialog } from '../components/ui.jsx';
import { T, useT } from '../i18n/useT.js';

export const useDirty = (value, ready = true) => {
  const base = useRef(null);
  const json = JSON.stringify(value);
  if (ready && base.current === null) base.current = json;
  return { dirty: base.current !== null && base.current !== json, clean: () => { base.current = json; } };
};

const TITLE = T('Leave without saving?');
const BODY = T('You have changes that are not saved. If you leave now they are lost.');
const LEAVE = T('Leave');

export const useUnsavedWarning = (dirty) => {
  const dialog = useDialog();
  const tr = useT();
  const navigate = useNavigate();
  useEffect(() => {
    if (!dirty) return undefined;
    const beforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    const onClick = async (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname + url.search === window.location.pathname + window.location.search) return;
      e.preventDefault(); e.stopPropagation();
      if (await dialog.confirm({ title: tr(TITLE), body: tr(BODY), confirmLabel: tr(LEAVE), danger: true })) navigate(url.pathname + url.search + url.hash);
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onClick, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', onClick, true); };
  }, [dirty, dialog, navigate, tr]);
};
