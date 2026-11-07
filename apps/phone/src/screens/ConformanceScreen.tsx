import { algorithmVersion } from '@milewage/track-engine';
import { useState } from 'react';
import { View } from 'react-native';
import { Check, Gauge, X } from 'lucide-react-native';
import { Button } from '../components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Text } from '../components/ui/text';
import fixtures from '../conformance/fixtures.json';
import {
  formatReport,
  runConformance,
  type ConformanceFixtures,
  type ConformanceReport,
} from '../conformance/harness';
import { cn } from '../lib/utils';
import { useColors } from '../theme/theme';
import { Screen } from '../ui/Screen';

/**
 * Developer check (spikes A10 and A12): the phone runs the mileage engine on saved test rides and
 * compares each answer with the one the server's runtime (Node) gave, byte for byte, then times a
 * long shift. Plain verdicts first; the raw report is kept for bug reports.
 */
export function ConformanceScreen() {
  const [report, setReport] = useState<ConformanceReport | null>(null);
  const same = report ? report.allIdentical && report.versionMatches : false;
  const passed = report ? report.fixtures.filter((f) => f.ok).length : 0;

  return (
    <Screen title="Engine check" description="Developer test of the mileage engine on this phone.">
      <Text variant="muted">
        Your phone shows a distance before the server confirms it. This check makes sure both work
        it out the same way: it runs {fixtures.inputs ? Object.keys(fixtures.inputs).length : 0}{' '}
        saved test rides here and compares every answer with the server&apos;s.
      </Text>
      <Button
        variant="outline"
        className="h-12"
        onPress={() => setReport(runConformance(fixtures as ConformanceFixtures, algorithmVersion))}
      >
        <Text>{report ? 'Run again' : 'Run engine check'}</Text>
      </Button>
      {report && (
        <>
          <Verdict
            ok={same}
            icon={same ? Check : X}
            title={
              same
                ? 'This phone calculates mileage exactly like your server'
                : 'This phone and your server disagree'
            }
            detail={
              same
                ? `${passed} of ${report.fixtures.length} test rides match to the last digit.`
                : !report.versionMatches
                  ? 'The app and the test rides are from different versions. Update the app.'
                  : `${report.fixtures.length - passed} of ${report.fixtures.length} test rides differ. Totals will be corrected by the server; keep the details below for a bug report.`
            }
          />
          <Verdict
            ok={report.timing.withinBar}
            icon={Gauge}
            title={report.timing.withinBar ? 'Fast enough' : 'Slower than expected'}
            detail={`A ${report.timing.fixes.toLocaleString('en')}-point shift takes ${report.timing.medianMs} ms to calculate (limit ${report.timing.barMs} ms).`}
          />
          <Card>
            <CardHeader>
              <CardTitle>Technical details</CardTitle>
              <CardDescription>
                {`"runtime: hermes" means the phone's JavaScript engine (Hermes); the server uses Node. A10 is the match test, A12 the speed test.`}
              </CardDescription>
              <Text testID="conformance-report" selectable variant="mono" className="pt-2">
                {formatReport(report)}
              </Text>
            </CardHeader>
          </Card>
        </>
      )}
    </Screen>
  );
}

function Verdict({
  ok,
  icon: Icon,
  title,
  detail,
}: {
  ok: boolean;
  icon: typeof Check;
  title: string;
  detail: string;
}) {
  const C = useColors();
  return (
    <Card accessibilityLabel={`${ok ? 'Passed' : 'Problem'}: ${title}`}>
      <CardHeader className="flex-row items-start gap-3">
        <View
          className={cn(
            'h-9 w-9 items-center justify-center rounded-full',
            ok ? 'bg-primary' : 'bg-destructive/15',
          )}
        >
          <Icon size={18} color={ok ? C.primaryForeground : C.destructive} strokeWidth={2.5} />
        </View>
        <View className="flex-1 gap-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{detail}</CardDescription>
        </View>
      </CardHeader>
    </Card>
  );
}
