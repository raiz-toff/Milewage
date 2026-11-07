import * as React from 'react';
import { View } from 'react-native';
import { cn } from '../../lib/utils';
import { Text, TextClassContext } from './text';

type ViewProps = React.ComponentProps<typeof View> & { className?: string };
type TextProps = React.ComponentProps<typeof Text>;

/** shadcn/ui Card: rounded-xl, hairline border, card surface, 16 px rhythm (web `card.tsx`). */
function Card({ className, ...props }: ViewProps) {
  return (
    <TextClassContext.Provider value="text-card-foreground">
      <View
        className={cn('gap-4 rounded-xl border border-border bg-card py-4', className)}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

function CardHeader({ className, ...props }: ViewProps) {
  return <View className={cn('gap-1 px-4', className)} {...props} />;
}

function CardTitle({ className, ...props }: TextProps) {
  return (
    <Text
      role="heading"
      className={cn('font-sans-medium text-base leading-snug', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: TextProps) {
  return <Text className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

function CardContent({ className, ...props }: ViewProps) {
  return <View className={cn('gap-3 px-4', className)} {...props} />;
}

function CardFooter({ className, ...props }: ViewProps) {
  return <View className={cn('flex-row items-center gap-2 px-4', className)} {...props} />;
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
