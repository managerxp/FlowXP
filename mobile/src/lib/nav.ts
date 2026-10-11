import { router } from 'expo-router';

/** Go back, or to the start when there is nothing behind this screen (the app was opened on it, or it replaced another). */
export const goBack = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
