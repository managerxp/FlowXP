import { router } from 'expo-router';
import { Panel, SetupShell } from '../lib/formKit.tsx';
import { Line } from '../lib/ui.tsx';

/* Help and support: everything about getting help in one place, so More has a single entry for it. */
export default function HelpCenter() {
  return (
    <SetupShell title="Help and support" sub="How can we help?" ok denied="">
      <Panel>
        <Line icon="search-outline" left="Help me find" sub="Tell me where things are: say what you want to do" onPress={() => router.push('/help-find')} />
        <Line icon="help-circle-outline" left="Help" sub="How to do things, and the quick tour" onPress={() => router.push('/help')} />
        <Line icon="chatbubbles-outline" left="Raise a ticket" sub="Ask FlowXP a question and read the answer" onPress={() => router.push('/support')} />
        <Line icon="bug-outline" left="Report a problem" sub="Tell FlowXP something went wrong" onPress={() => router.push('/report')} />
      </Panel>
    </SetupShell>
  );
}
