import { View } from 'react-native';
import { Check, ChevronRight } from 'lucide-react-native';
import { Badge } from '../components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Text } from '../components/ui/text';
import { cn } from '../lib/utils';
import { useColors } from '../theme/theme';
import { ListRow, Rows } from '../ui/Parts';

export interface SetupItem {
  key: string;
  title: string;
  detail: string;
  done: boolean;
  onPress: () => void;
}

/**
 * "Finish setting up", as on the web dashboard: what is left before the first shift, each row
 * done or not from real state. The card removes itself once all are done.
 */
export function SetupChecklist({ items }: { items: SetupItem[] }) {
  const C = useColors();
  const left = items.filter((i) => !i.done).length;
  if (left === 0) return null;
  return (
    <Card accessibilityLabel="Finish setting up" className="pb-0">
      <CardHeader className="flex-row items-start justify-between">
        <View className="flex-1 gap-1">
          <CardTitle>Finish setting up</CardTitle>
          <CardDescription>{`${left} ${left === 1 ? 'step' : 'steps'} left before your first shift.`}</CardDescription>
        </View>
        <Badge variant="secondary">
          <Text tabular>{`${items.length - left}/${items.length}`}</Text>
        </Badge>
      </CardHeader>
      <View className="border-t border-border">
        <Rows>
          {items.map((item) => (
            <ListRow
              key={item.key}
              accessibilityLabel={item.title}
              onPress={item.done ? undefined : item.onPress}
            >
              <View
                className={cn(
                  'h-6 w-6 items-center justify-center rounded-full border',
                  item.done ? 'border-primary bg-primary' : 'border-input',
                )}
              >
                {item.done && <Check size={14} color={C.primaryForeground} strokeWidth={3} />}
              </View>
              <View className="flex-1 gap-0.5">
                <Text
                  variant="label"
                  className={item.done ? 'text-muted-foreground line-through' : ''}
                >
                  {item.title}
                </Text>
                {!item.done && <Text variant="muted">{item.detail}</Text>}
              </View>
              {!item.done && <ChevronRight size={18} color={C.mutedForeground} />}
            </ListRow>
          ))}
        </Rows>
      </View>
    </Card>
  );
}
