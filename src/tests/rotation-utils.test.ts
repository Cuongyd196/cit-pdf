import { describe, it, expect } from 'vitest';
import {
  ROTATION_MIN,
  ROTATION_MAX,
  ROTATION_STEP,
  clampRotation,
  roundToStep,
  parseAngleInput,
} from '@/js/utils/rotation-utils';

describe('rotation-utils', () => {
  describe('constants', () => {
    it('uses ±360° as the rotation bounds', () => {
      expect(ROTATION_MIN).toBe(-360);
      expect(ROTATION_MAX).toBe(360);
    });

    it('uses 0.1° as the step size', () => {
      expect(ROTATION_STEP).toBe(0.1);
    });
  });

  describe('clampRotation', () => {
    it('returns the value unchanged when within bounds', () => {
      expect(clampRotation(0)).toBe(0);
      expect(clampRotation(45)).toBe(45);
      expect(clampRotation(-45)).toBe(-45);
      expect(clampRotation(359.9)).toBe(359.9);
      expect(clampRotation(-359.9)).toBe(-359.9);
    });

    it('clamps values exactly at the bounds', () => {
      expect(clampRotation(360)).toBe(360);
      expect(clampRotation(-360)).toBe(-360);
    });

    it('clamps values above the upper bound', () => {
      expect(clampRotation(360.1)).toBe(360);
      expect(clampRotation(9999)).toBe(360);
      expect(clampRotation(Number.POSITIVE_INFINITY)).toBe(360);
    });

    it('clamps values below the lower bound', () => {
      expect(clampRotation(-360.1)).toBe(-360);
      expect(clampRotation(-9999)).toBe(-360);
      expect(clampRotation(Number.NEGATIVE_INFINITY)).toBe(-360);
    });
  });

  describe('roundToStep', () => {
    it('rounds to one decimal place', () => {
      expect(roundToStep(1.234)).toBe(1.2);
      expect(roundToStep(1.25)).toBe(1.3);
      expect(roundToStep(1.2)).toBe(1.2);
      expect(roundToStep(0)).toBe(0);
    });

    it('handles negative values', () => {
      expect(roundToStep(-1.234)).toBe(-1.2);
      expect(roundToStep(-1.27)).toBe(-1.3);
    });
  });

  describe('parseAngleInput', () => {
    it('parses a valid number string', () => {
      expect(parseAngleInput('45')).toBe(45);
      expect(parseAngleInput('-30.5')).toBe(-30.5);
      expect(parseAngleInput('0')).toBe(0);
    });

    it('rounds to one decimal place', () => {
      expect(parseAngleInput('1.234')).toBe(1.2);
      expect(parseAngleInput('-1.27')).toBe(-1.3);
    });

    it('clamps to ROTATION_MIN / ROTATION_MAX', () => {
      expect(parseAngleInput('9999')).toBe(360);
      expect(parseAngleInput('-9999')).toBe(-360);
      expect(parseAngleInput('400.7')).toBe(360);
    });

    it('returns the fallback for non-numeric input', () => {
      expect(parseAngleInput('abc')).toBe(0);
      expect(parseAngleInput('')).toBe(0);
      expect(parseAngleInput('   ')).toBe(0);
    });

    it('returns the fallback for NaN / Infinity strings', () => {
      expect(parseAngleInput('NaN')).toBe(0);
      expect(parseAngleInput('Infinity')).toBe(0);
      expect(parseAngleInput('-Infinity')).toBe(0);
    });

    it('uses a custom fallback when provided', () => {
      expect(parseAngleInput('abc', 90)).toBe(90);
      expect(parseAngleInput('', -45)).toBe(-45);
    });

    it('parses leading/trailing whitespace via parseFloat semantics', () => {
      expect(parseAngleInput('  45  ')).toBe(45);
      expect(parseAngleInput('45deg')).toBe(45);
    });

    it('does not return values outside ±360 even with a fallback', () => {
      expect(parseAngleInput('500')).toBe(360);
      expect(parseAngleInput('-500')).toBe(-360);
    });
  });
});
