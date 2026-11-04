import { algorithmVersion } from '@milewage/track-engine';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { touchTarget } from '@milewage/shared';
import fixtures from '../conformance/fixtures.json';
import {
  formatReport,
  runConformance,
  type ConformanceFixtures,
  type ConformanceReport,
} from '../conformance/harness';
import { useTheme } from '../theme/theme';
import { Screen } from './Screen';

/** Developer check for spike A10 / A12: run the engine on this phone and compare with Node. */
export function ConformanceScreen() {
  const theme = useTheme();
  const [report, setReport] = useState<ConformanceReport | null>(null);

  return (
    <Screen title="Engine check">
      <Text style={{ color: theme.textMuted }}>
        Runs the track engine on this phone and compares every result with the one Node produced.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => setReport(runConformance(fixtures as ConformanceFixtures, algorithmVersion))}
        style={[styles.button, { borderColor: theme.border, backgroundColor: theme.card }]}
      >
        <Text style={{ color: theme.accent }}>Run engine check</Text>
      </Pressable>
      {report && (
        <ScrollView>
          <Text testID="conformance-report" selectable style={{ color: theme.text, marginTop: 12 }}>
            {formatReport(report)}
          </Text>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  button: {
    marginTop: 16,
    minHeight: touchTarget.min,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
  },
});
