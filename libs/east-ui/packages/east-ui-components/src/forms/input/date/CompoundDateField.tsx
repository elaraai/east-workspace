/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import React, { useRef, useMemo } from 'react';
import { Box, Text, useSlotRecipe, type SystemStyleObject } from '@chakra-ui/react';
import { useDateField, useDateSegment } from '@react-aria/datepicker';
import { useDateFieldState } from '@react-stately/datepicker';
import { createCalendar } from '@internationalized/date';
import type { DateFieldState, DateSegment as DateSegmentType } from '@react-stately/datepicker';
import type { AriaDateFieldProps } from '@react-aria/datepicker';
import type { DateValue } from '@internationalized/date';

interface DateFieldContextValue {
  styles: Record<string, SystemStyleObject>;
  state: DateFieldState;
  fieldProps: React.HTMLAttributes<HTMLElement>;
  fieldRef: React.RefObject<HTMLDivElement | null>;
}

const DateFieldContext = React.createContext<DateFieldContextValue | null>(null);

interface DateFieldProps extends AriaDateFieldProps<DateValue> {
  children: React.ReactNode;
  /** Shared input size; the containing surface can derive this from its density. */
  size?: "xs" | "sm" | "md" | "lg";
  value?: DateValue;
  onChange?: (value: DateValue | null) => void;
  isReadOnly?: boolean;
}

export function DateField({ children, value, onChange, isReadOnly, size = "md", ...props }: DateFieldProps) {
  const recipe = useSlotRecipe({ key: 'dateField' });
  const styles = recipe({ size });
  // Force en-GB locale for DD/MM/YYYY format
  const dateLocale = 'en-GB';
  
  const state = useDateFieldState({ 
    ...props,
    value: value ?? null,
    ...(onChange && { onChange }),
    locale: dateLocale,
    createCalendar,
    isReadOnly: isReadOnly ?? false
  });
  const fieldRef = useRef<HTMLDivElement>(null);
  const { fieldProps } = useDateField({ ...props, isReadOnly: isReadOnly ?? false }, state, fieldRef);

  const contextValue = useMemo(() => ({
    styles,
    state,
    fieldProps,
    fieldRef
  }), [styles, state, fieldProps]);

  return (
    <DateFieldContext.Provider value={contextValue}>
      <Box css={styles.root}>{children}</Box>
    </DateFieldContext.Provider>
  );
}

interface LabelProps {
  children: React.ReactNode;
}

export function Label({ children }: LabelProps) {
  const recipe = useSlotRecipe({ key: 'dateField' });
  const styles = recipe({});
  return (
    <Text css={styles.label}>
      {children}
    </Text>
  );
}

interface DateInputProps {
  children: (props: { segment: DateSegmentType; key: number }) => React.ReactNode;
}

export function DateInput({ children }: DateInputProps) {
  const context = React.useContext(DateFieldContext);
  if (!context) {
    throw new Error('DateInput must be used within a DateField');
  }

  const { state, fieldProps, fieldRef, styles } = context;

  return (
    <Box
      {...fieldProps}
      ref={fieldRef}
      css={styles.input}
      data-readonly={state.isReadOnly ? "" : undefined}
    >
      {state.segments.map((segment, i) => (
        <React.Fragment key={i}>
          {children({ segment, key: i })}
        </React.Fragment>
      ))}
    </Box>
  );
}

interface DateSegmentProps {
  segment: DateSegmentType;
}

export function DateSegment({ segment }: DateSegmentProps) {
  const ref = useRef<HTMLDivElement>(null);
  const context = React.useContext(DateFieldContext);
  if (!context) {
    throw new Error('DateSegment must be used within a DateField');
  }
  
  const { state, styles } = context;
  const { segmentProps } = useDateSegment(segment, state, ref);
  
  return (
    <Box
      {...segmentProps}
      ref={ref}
      css={styles.segment}
      data-placeholder={segment.isPlaceholder ? "" : undefined}
      data-readonly={state.isReadOnly ? "" : undefined}
      data-literal={segment.type === "literal" ? "" : undefined}
    >
      {segment.text}
    </Box>
  );
}