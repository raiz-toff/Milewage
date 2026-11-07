import * as React from 'react';
import { View } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';
import { useColors } from '../../theme/theme';
import { Text, TextClassContext } from './text';

// shadcn/ui Alert (web `alert.tsx`): bordered box, icon on the left, title and description.
const alertVariants = cva('flex-row gap-3 rounded-lg border px-4 py-3', {
  variants: {
    variant: {
      default: 'border-border bg-card',
      destructive: 'border-destructive/40 bg-card',
    },
  },
  defaultVariants: { variant: 'default' },
});

type IconType = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

function Alert({
  className,
  variant,
  icon: Icon,
  children,
  ...props
}: React.ComponentProps<typeof View> &
  VariantProps<typeof alertVariants> & { className?: string; icon?: IconType }) {
  const C = useColors();
  const tone = variant === 'destructive' ? C.destructive : C.foreground;
  return (
    <TextClassContext.Provider
      value={variant === 'destructive' ? 'text-destructive' : 'text-card-foreground'}
    >
      <View role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
        {Icon && (
          <View className="pt-0.5">
            <Icon size={16} color={tone} strokeWidth={2} />
          </View>
        )}
        <View className="flex-1 gap-1.5">{children}</View>
      </View>
    </TextClassContext.Provider>
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<typeof Text>) {
  return <Text className={cn('font-sans-medium text-sm tracking-tight', className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<typeof Text>) {
  return <Text className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export { Alert, AlertDescription, AlertTitle };
