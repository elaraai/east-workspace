/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * A Plan's chart rows, each styled its own way (#1753, #1750): ten weeks of a
 * print works' readings —
 *
 * - `planCharts`, columns, lines, areas, bands, scatter and target zones on one
 *   axis and on two: combos, stacks of columns and of areas, columns side by
 *   side, a sparse line, every stroke and curve, a row with more series than
 *   room, and sparks at a row's own height. Each row's legend names its series
 *   in their colours with their units, and hovering a week reads them all. The
 *   right axes read their numbers in a rail after every row's plot.
 *
 * @packageDocumentation
 */

import {
    DateTimeType, DictType, East, FloatType, OptionType, SortedMap, StringType, StructType, compareFor, example, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Chart, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

/**
 * A chart row's readings: the chart that draws it, its name, its second line
 * and its value — none where it shows none — and each week's values by the
 * series they belong to, keyed by the middle of their week, so a point stands
 * over its week's column. A week a series read nothing in holds `NaN`, a gap
 * its line breaks at.
 */
export const ChartMeasure = StructType({
    chart: StringType,
    label: StringType,
    sub: OptionType(StringType),
    value: OptionType(StringType),
    weeks: DictType(DateTimeType, DictType(StringType, FloatType)),
});

/**
 * Ten weeks of readings, W23–W32 (from Monday 1 June 2026), each at the middle
 * of its week, now the start of W29: what a row reads before it is done, what
 * after it is planned. A row's weeks each hold every series its chart reads.
 */
export const planChartMeasures = e3.input("plan_chart_measures", DictType(StringType, ChartMeasure), variant("value", new Map<string, ValueTypeOf<typeof ChartMeasure>>([
    // ── One axis ──
    // Sheets printed until now, the forecast across every week in its range, and the target.
    ["output", {
        chart: "combo", label: "Output", sub: none, value: none,
        weeks: new SortedMap([
            [new Date("2026-06-04T12:00:00Z"), new Map([["Printed", 28.0], ["Forecast", 30.0], ["Low", 27.0], ["High", 33.0]])],
            [new Date("2026-06-11T12:00:00Z"), new Map([["Printed", 34.0], ["Forecast", 33.0], ["Low", 30.0], ["High", 36.0]])],
            [new Date("2026-06-18T12:00:00Z"), new Map([["Printed", 40.0], ["Forecast", 37.0], ["Low", 34.0], ["High", 40.0]])],
            [new Date("2026-06-25T12:00:00Z"), new Map([["Printed", 29.0], ["Forecast", 34.0], ["Low", 31.0], ["High", 37.0]])],
            [new Date("2026-07-02T12:00:00Z"), new Map([["Printed", 35.0], ["Forecast", 36.0], ["Low", 33.0], ["High", 39.0]])],
            [new Date("2026-07-09T12:00:00Z"), new Map([["Printed", 41.0], ["Forecast", 39.0], ["Low", 36.0], ["High", 42.0]])],
            [new Date("2026-07-16T12:00:00Z"), new Map([["Printed", Number.NaN], ["Forecast", 38.0], ["Low", 34.0], ["High", 42.0]])],
            [new Date("2026-07-23T12:00:00Z"), new Map([["Printed", Number.NaN], ["Forecast", 40.0], ["Low", 35.0], ["High", 45.0]])],
            [new Date("2026-07-30T12:00:00Z"), new Map([["Printed", Number.NaN], ["Forecast", 41.0], ["Low", 35.0], ["High", 47.0]])],
            [new Date("2026-08-06T12:00:00Z"), new Map([["Printed", Number.NaN], ["Forecast", 43.0], ["Low", 36.0], ["High", 50.0]])],
        ], compareFor(DateTimeType)),
    }],
    // Each hall's sheets, and the plan they are printed against.
    ["halls", {
        chart: "halls", label: "Printed by hall", sub: some("three halls"), value: none,
        weeks: new SortedMap([
            [new Date("2026-06-04T12:00:00Z"), new Map([["Hall 1", 14.0], ["Hall 2", 9.0], ["Hall 3", 5.0], ["Plan", 30.0]])],
            [new Date("2026-06-11T12:00:00Z"), new Map([["Hall 1", 16.0], ["Hall 2", 11.0], ["Hall 3", 6.0], ["Plan", 32.0]])],
            [new Date("2026-06-18T12:00:00Z"), new Map([["Hall 1", 18.0], ["Hall 2", 12.0], ["Hall 3", 8.0], ["Plan", 34.0]])],
            [new Date("2026-06-25T12:00:00Z"), new Map([["Hall 1", 15.0], ["Hall 2", 10.0], ["Hall 3", 6.0], ["Plan", 33.0]])],
            [new Date("2026-07-02T12:00:00Z"), new Map([["Hall 1", 17.0], ["Hall 2", 12.0], ["Hall 3", 7.0], ["Plan", 35.0]])],
            [new Date("2026-07-09T12:00:00Z"), new Map([["Hall 1", 19.0], ["Hall 2", 13.0], ["Hall 3", 9.0], ["Plan", 37.0]])],
            [new Date("2026-07-16T12:00:00Z"), new Map([["Hall 1", 18.0], ["Hall 2", 12.0], ["Hall 3", 8.0], ["Plan", 38.0]])],
            [new Date("2026-07-23T12:00:00Z"), new Map([["Hall 1", 20.0], ["Hall 2", 14.0], ["Hall 3", 9.0], ["Plan", 40.0]])],
            [new Date("2026-07-30T12:00:00Z"), new Map([["Hall 1", 21.0], ["Hall 2", 13.0], ["Hall 3", 10.0], ["Plan", 41.0]])],
            [new Date("2026-08-06T12:00:00Z"), new Map([["Hall 1", 19.0], ["Hall 2", 12.0], ["Hall 3", 9.0], ["Plan", 42.0]])],
        ], compareFor(DateTimeType)),
    }],
    // The jobs planned each week beside those done, until now: a week done under 20 breaches.
    ["jobs", {
        chart: "jobs", label: "Jobs a week", sub: none, value: none,
        weeks: new SortedMap([
            [new Date("2026-06-04T12:00:00Z"), new Map([["Planned", 22.0], ["Done", 21.0]])],
            [new Date("2026-06-11T12:00:00Z"), new Map([["Planned", 24.0], ["Done", 25.0]])],
            [new Date("2026-06-18T12:00:00Z"), new Map([["Planned", 25.0], ["Done", 19.0]])],
            [new Date("2026-06-25T12:00:00Z"), new Map([["Planned", 23.0], ["Done", 23.0]])],
            [new Date("2026-07-02T12:00:00Z"), new Map([["Planned", 26.0], ["Done", 26.0]])],
            [new Date("2026-07-09T12:00:00Z"), new Map([["Planned", 27.0], ["Done", 17.0]])],
            [new Date("2026-07-16T12:00:00Z"), new Map([["Planned", 26.0], ["Done", Number.NaN]])],
            [new Date("2026-07-23T12:00:00Z"), new Map([["Planned", 28.0], ["Done", Number.NaN]])],
            [new Date("2026-07-30T12:00:00Z"), new Map([["Planned", 29.0], ["Done", Number.NaN]])],
            [new Date("2026-08-06T12:00:00Z"), new Map([["Planned", 27.0], ["Done", Number.NaN]])],
        ], compareFor(DateTimeType)),
    }],
    // The hours each press ran.
    ["press-hours", {
        chart: "press-hours", label: "Hours by press", sub: none, value: none,
        weeks: new SortedMap([
            [new Date("2026-06-04T12:00:00Z"), new Map([["Press A", 32.0], ["Press B", 24.0], ["Press C", 12.0]])],
            [new Date("2026-06-11T12:00:00Z"), new Map([["Press A", 35.0], ["Press B", 22.0], ["Press C", 15.0]])],
            [new Date("2026-06-18T12:00:00Z"), new Map([["Press A", 30.0], ["Press B", 26.0], ["Press C", 14.0]])],
            [new Date("2026-06-25T12:00:00Z"), new Map([["Press A", 34.0], ["Press B", 25.0], ["Press C", 16.0]])],
            [new Date("2026-07-02T12:00:00Z"), new Map([["Press A", 36.0], ["Press B", 23.0], ["Press C", 18.0]])],
            [new Date("2026-07-09T12:00:00Z"), new Map([["Press A", 38.0], ["Press B", 27.0], ["Press C", 17.0]])],
            [new Date("2026-07-16T12:00:00Z"), new Map([["Press A", 35.0], ["Press B", 26.0], ["Press C", 19.0]])],
            [new Date("2026-07-23T12:00:00Z"), new Map([["Press A", 37.0], ["Press B", 24.0], ["Press C", 18.0]])],
            [new Date("2026-07-30T12:00:00Z"), new Map([["Press A", 39.0], ["Press B", 25.0], ["Press C", 20.0]])],
            [new Date("2026-08-06T12:00:00Z"), new Map([["Press A", 36.0], ["Press B", 28.0], ["Press C", 21.0]])],
        ], compareFor(DateTimeType)),
    }],
    // ── Two axes ──
    // The hall's load, in %, beside the press room's temperature, in °C.
    ["climate", {
        chart: "climate", label: "Load, temperature", sub: none, value: none,
        weeks: new SortedMap([
            [new Date("2026-06-04T12:00:00Z"), new Map([["Load", 52.0], ["Temp",21.0]])],
            [new Date("2026-06-11T12:00:00Z"), new Map([["Load", 61.0], ["Temp",23.0]])],
            [new Date("2026-06-18T12:00:00Z"), new Map([["Load", 68.0], ["Temp",24.0]])],
            [new Date("2026-06-25T12:00:00Z"), new Map([["Load", 74.0], ["Temp",26.0]])],
            [new Date("2026-07-02T12:00:00Z"), new Map([["Load", 71.0], ["Temp",27.0]])],
            [new Date("2026-07-09T12:00:00Z"), new Map([["Load", 66.0], ["Temp",25.0]])],
            [new Date("2026-07-16T12:00:00Z"), new Map([["Load", 58.0], ["Temp",22.0]])],
            [new Date("2026-07-23T12:00:00Z"), new Map([["Load", 49.0], ["Temp",20.0]])],
            [new Date("2026-07-30T12:00:00Z"), new Map([["Load", 45.0], ["Temp",19.0]])],
            [new Date("2026-08-06T12:00:00Z"), new Map([["Load", 50.0], ["Temp",21.0]])],
        ], compareFor(DateTimeType)),
    }],
    // Sheets printed, in thousands, beside the share of jobs delivered on time.
    ["quality", {
        chart: "quality", label: "Output and on-time", sub: none, value: none,
        weeks: new SortedMap([
            [new Date("2026-06-04T12:00:00Z"), new Map([["Sheets",42.0], ["On-time", 96.1]])],
            [new Date("2026-06-11T12:00:00Z"), new Map([["Sheets",47.0], ["On-time", 95.4]])],
            [new Date("2026-06-18T12:00:00Z"), new Map([["Sheets",51.0], ["On-time", 93.8]])],
            [new Date("2026-06-25T12:00:00Z"), new Map([["Sheets",38.0], ["On-time", 90.2]])],
            [new Date("2026-07-02T12:00:00Z"), new Map([["Sheets",45.0], ["On-time", 92.6]])],
            [new Date("2026-07-09T12:00:00Z"), new Map([["Sheets",53.0], ["On-time", 94.4]])],
            [new Date("2026-07-16T12:00:00Z"), new Map([["Sheets",49.0], ["On-time", 95.0]])],
            [new Date("2026-07-23T12:00:00Z"), new Map([["Sheets",50.0], ["On-time", 95.6]])],
            [new Date("2026-07-30T12:00:00Z"), new Map([["Sheets",52.0], ["On-time", 96.2]])],
            [new Date("2026-08-06T12:00:00Z"), new Map([["Sheets",48.0], ["On-time", 96.8]])],
        ], compareFor(DateTimeType)),
    }],
    // ── Points ──
    // An audit's score in the weeks one was held, and the score on average.
    ["audits", {
        chart: "audits", label: "Inspections", sub: none, value: none,
        weeks: new SortedMap([
            [new Date("2026-06-04T12:00:00Z"), new Map([["Audit", 92.0], ["Average", 90.0]])],
            [new Date("2026-06-11T12:00:00Z"), new Map([["Audit", Number.NaN], ["Average", 90.0]])],
            [new Date("2026-06-18T12:00:00Z"), new Map([["Audit", 86.0], ["Average", 89.0]])],
            [new Date("2026-06-25T12:00:00Z"), new Map([["Audit", 88.0], ["Average", 89.0]])],
            [new Date("2026-07-02T12:00:00Z"), new Map([["Audit", Number.NaN], ["Average", 90.0]])],
            [new Date("2026-07-09T12:00:00Z"), new Map([["Audit", 95.0], ["Average", 91.0]])],
            [new Date("2026-07-16T12:00:00Z"), new Map([["Audit", Number.NaN], ["Average", 91.0]])],
            [new Date("2026-07-23T12:00:00Z"), new Map([["Audit", 90.0], ["Average", 91.0]])],
            [new Date("2026-07-30T12:00:00Z"), new Map([["Audit", 91.0], ["Average", 91.0]])],
            [new Date("2026-08-06T12:00:00Z"), new Map([["Audit", Number.NaN], ["Average", 92.0]])],
        ], compareFor(DateTimeType)),
    }],
    // Each press's defects a week, in parts per million.
    ["defects", {
        chart: "defects", label: "Defects by press", sub: none, value: none,
        weeks: new SortedMap([
            [new Date("2026-06-04T12:00:00Z"), new Map([["Press A", 120.0], ["Press B", 98.0]])],
            [new Date("2026-06-11T12:00:00Z"), new Map([["Press A", 157.0], ["Press B", 110.0]])],
            [new Date("2026-06-18T12:00:00Z"), new Map([["Press A", 134.0], ["Press B", 141.0]])],
            [new Date("2026-06-25T12:00:00Z"), new Map([["Press A", 171.0], ["Press B", 102.0]])],
            [new Date("2026-07-02T12:00:00Z"), new Map([["Press A", 148.0], ["Press B", 95.0]])],
            [new Date("2026-07-09T12:00:00Z"), new Map([["Press A", 125.0], ["Press B", 133.0]])],
            [new Date("2026-07-16T12:00:00Z"), new Map([["Press A", 162.0], ["Press B", 118.0]])],
            [new Date("2026-07-23T12:00:00Z"), new Map([["Press A", 139.0], ["Press B", 104.0]])],
            [new Date("2026-07-30T12:00:00Z"), new Map([["Press A", 176.0], ["Press B", 99.0]])],
            [new Date("2026-08-06T12:00:00Z"), new Map([["Press A", 153.0], ["Press B", 127.0]])],
        ], compareFor(DateTimeType)),
    }],
    // ── Line styles ──
    // Five lines a step apart, each drawn in its own stroke.
    ["strokes", {
        chart: "strokes", label: "Strokes", sub: none, value: none,
        weeks: new SortedMap([
            [new Date("2026-06-04T12:00:00Z"), new Map([["Default", 50.0], ["Thick", 40.0], ["Dashed", 30.0], ["Dotted", 20.0], ["Faint", 10.0]])],
            [new Date("2026-06-11T12:00:00Z"), new Map([["Default", 51.0], ["Thick", 41.0], ["Dashed", 31.0], ["Dotted", 21.0], ["Faint", 11.0]])],
            [new Date("2026-06-18T12:00:00Z"), new Map([["Default", 52.0], ["Thick", 42.0], ["Dashed", 32.0], ["Dotted", 22.0], ["Faint", 12.0]])],
            [new Date("2026-06-25T12:00:00Z"), new Map([["Default", 51.0], ["Thick", 41.0], ["Dashed", 31.0], ["Dotted", 21.0], ["Faint", 11.0]])],
            [new Date("2026-07-02T12:00:00Z"), new Map([["Default", 52.0], ["Thick", 42.0], ["Dashed", 32.0], ["Dotted", 22.0], ["Faint", 12.0]])],
            [new Date("2026-07-09T12:00:00Z"), new Map([["Default", 53.0], ["Thick", 43.0], ["Dashed", 33.0], ["Dotted", 23.0], ["Faint", 13.0]])],
            [new Date("2026-07-16T12:00:00Z"), new Map([["Default", 52.0], ["Thick", 42.0], ["Dashed", 32.0], ["Dotted", 22.0], ["Faint", 12.0]])],
            [new Date("2026-07-23T12:00:00Z"), new Map([["Default", 53.0], ["Thick", 43.0], ["Dashed", 33.0], ["Dotted", 23.0], ["Faint", 13.0]])],
            [new Date("2026-07-30T12:00:00Z"), new Map([["Default", 54.0], ["Thick", 44.0], ["Dashed", 34.0], ["Dotted", 24.0], ["Faint", 14.0]])],
            [new Date("2026-08-06T12:00:00Z"), new Map([["Default", 53.0], ["Thick", 43.0], ["Dashed", 33.0], ["Dotted", 23.0], ["Faint", 13.0]])],
        ], compareFor(DateTimeType)),
    }],
    // One zigzag four times over, a step apart, each joined by its own curve.
    ["curves", {
        chart: "curves", label: "Curves", sub: none, value: none,
        weeks: new SortedMap([
            [new Date("2026-06-04T12:00:00Z"), new Map([["Linear", 55.0], ["Smooth", 40.0], ["Natural", 25.0], ["Step", 10.0]])],
            [new Date("2026-06-11T12:00:00Z"), new Map([["Linear", 63.0], ["Smooth", 48.0], ["Natural", 33.0], ["Step", 18.0]])],
            [new Date("2026-06-18T12:00:00Z"), new Map([["Linear", 57.0], ["Smooth", 42.0], ["Natural", 27.0], ["Step", 12.0]])],
            [new Date("2026-06-25T12:00:00Z"), new Map([["Linear", 65.0], ["Smooth", 50.0], ["Natural", 35.0], ["Step", 20.0]])],
            [new Date("2026-07-02T12:00:00Z"), new Map([["Linear", 59.0], ["Smooth", 44.0], ["Natural", 29.0], ["Step", 14.0]])],
            [new Date("2026-07-09T12:00:00Z"), new Map([["Linear", 67.0], ["Smooth", 52.0], ["Natural", 37.0], ["Step", 22.0]])],
            [new Date("2026-07-16T12:00:00Z"), new Map([["Linear", 61.0], ["Smooth", 46.0], ["Natural", 31.0], ["Step", 16.0]])],
            [new Date("2026-07-23T12:00:00Z"), new Map([["Linear", 69.0], ["Smooth", 54.0], ["Natural", 39.0], ["Step", 24.0]])],
            [new Date("2026-07-30T12:00:00Z"), new Map([["Linear", 63.0], ["Smooth", 48.0], ["Natural", 33.0], ["Step", 18.0]])],
            [new Date("2026-08-06T12:00:00Z"), new Map([["Linear", 71.0], ["Smooth", 56.0], ["Natural", 41.0], ["Step", 26.0]])],
        ], compareFor(DateTimeType)),
    }],
    // Six presses' sheets, thousands a week: more series than a short row has room to list.
    ["presses", {
        chart: "presses", label: "Press output", sub: none, value: none,
        weeks: new SortedMap([
            [new Date("2026-06-04T12:00:00Z"), new Map([["Press A", 32.0], ["Press B", 28.0], ["Press C", 24.0], ["Press D", 20.0], ["Press E", 16.0], ["Press F", 12.0]])],
            [new Date("2026-06-11T12:00:00Z"), new Map([["Press A", 33.0], ["Press B", 29.0], ["Press C", 26.0], ["Press D", 21.0], ["Press E", 18.0], ["Press F", 13.0]])],
            [new Date("2026-06-18T12:00:00Z"), new Map([["Press A", 35.0], ["Press B", 27.0], ["Press C", 25.0], ["Press D", 23.0], ["Press E", 17.0], ["Press F", 14.0]])],
            [new Date("2026-06-25T12:00:00Z"), new Map([["Press A", 34.0], ["Press B", 30.0], ["Press C", 27.0], ["Press D", 22.0], ["Press E", 19.0], ["Press F", 13.0]])],
            [new Date("2026-07-02T12:00:00Z"), new Map([["Press A", 36.0], ["Press B", 31.0], ["Press C", 26.0], ["Press D", 24.0], ["Press E", 18.0], ["Press F", 15.0]])],
            [new Date("2026-07-09T12:00:00Z"), new Map([["Press A", 37.0], ["Press B", 29.0], ["Press C", 28.0], ["Press D", 23.0], ["Press E", 20.0], ["Press F", 14.0]])],
            [new Date("2026-07-16T12:00:00Z"), new Map([["Press A", 36.0], ["Press B", 30.0], ["Press C", 27.0], ["Press D", 25.0], ["Press E", 19.0], ["Press F", 16.0]])],
            [new Date("2026-07-23T12:00:00Z"), new Map([["Press A", 38.0], ["Press B", 32.0], ["Press C", 29.0], ["Press D", 24.0], ["Press E", 21.0], ["Press F", 15.0]])],
            [new Date("2026-07-30T12:00:00Z"), new Map([["Press A", 39.0], ["Press B", 31.0], ["Press C", 28.0], ["Press D", 26.0], ["Press E", 20.0], ["Press F", 17.0]])],
            [new Date("2026-08-06T12:00:00Z"), new Map([["Press A", 38.0], ["Press B", 33.0], ["Press C", 30.0], ["Press D", 25.0], ["Press E", 22.0], ["Press F", 16.0]])],
        ], compareFor(DateTimeType)),
    }],
    // ── Sparks, at a row's own height ──
    // The share of jobs on time, a week apiece: July's first weeks dip under the 92 breach.
    ["on-time", {
        chart: "spark-line", label: "On-time", sub: none, value: some("96.8%"),
        weeks: new SortedMap([
            [new Date("2026-06-04T12:00:00Z"), new Map([["On-time", 96.1]])],
            [new Date("2026-06-11T12:00:00Z"), new Map([["On-time", 95.4]])],
            [new Date("2026-06-18T12:00:00Z"), new Map([["On-time", 93.8]])],
            [new Date("2026-06-25T12:00:00Z"), new Map([["On-time", 90.2]])],
            [new Date("2026-07-02T12:00:00Z"), new Map([["On-time", 91.6]])],
            [new Date("2026-07-09T12:00:00Z"), new Map([["On-time", 94.4]])],
            [new Date("2026-07-16T12:00:00Z"), new Map([["On-time", 95.0]])],
            [new Date("2026-07-23T12:00:00Z"), new Map([["On-time", 95.6]])],
            [new Date("2026-07-30T12:00:00Z"), new Map([["On-time", 96.2]])],
            [new Date("2026-08-06T12:00:00Z"), new Map([["On-time", 96.8]])],
        ], compareFor(DateTimeType)),
    }],
    // Sheets printed, thousands a week, the weeks after now planned.
    ["printed", {
        chart: "spark-columns", label: "Printed", sub: none, value: some("39 k"),
        weeks: new SortedMap([
            [new Date("2026-06-04T12:00:00Z"), new Map([["Printed", 28.0]])],
            [new Date("2026-06-11T12:00:00Z"), new Map([["Printed", 34.0]])],
            [new Date("2026-06-18T12:00:00Z"), new Map([["Printed", 40.0]])],
            [new Date("2026-06-25T12:00:00Z"), new Map([["Printed", 29.0]])],
            [new Date("2026-07-02T12:00:00Z"), new Map([["Printed", 35.0]])],
            [new Date("2026-07-09T12:00:00Z"), new Map([["Printed", 41.0]])],
            [new Date("2026-07-16T12:00:00Z"), new Map([["Printed", 38.0]])],
            [new Date("2026-07-23T12:00:00Z"), new Map([["Printed", 40.0]])],
            [new Date("2026-07-30T12:00:00Z"), new Map([["Printed", 41.0]])],
            [new Date("2026-08-06T12:00:00Z"), new Map([["Printed", 39.0]])],
        ], compareFor(DateTimeType)),
    }],
])));

/**
 * A print works' chart rows over ten weeks, each styled its own way — the
 * chart options a `Chart.*` layer takes, on a Plan row (#1753):
 *
 * - one axis: sheets printed as columns until now, under a smooth forecast in
 *   its range and a dashed red target; three halls' columns stacked beneath a
 *   dotted plan; jobs planned and done side by side, a week done under 20 in
 *   warn; three presses' hours as stacked areas;
 * - two axes: the hall's load as an area on the left beside a stepped
 *   temperature on the right, which reads its own numbers at the left's ticks;
 *   sheets as columns beside an on-time line with its dots, in its target zone;
 * - points: an audit's scores in the weeks one was held, a lone reading drawn
 *   as its dot, on no gridlines; two presses' defects as dots of their own
 *   sizes, under a limit;
 * - line styles: every stroke — width, dash, dots, strength — and every curve;
 *   six presses in a short row, its legend's last line saying how many more;
 * - sparks, at a row's own height: a line and columns, each opening taller.
 *
 * Each row taller than its own lines names its series down its gutter in their
 * colours, with their units (#1750), and hovering a week reads every series
 * there; the lines after now are planned, drawn dashed. The Plan declares the
 * right axis's rail (`rightAxis`): every row has a column after its plot, where
 * a two-axis row reads its right numbers, so the plot is one width on every row
 * and the weeks run straight down the page.
 */
export const planCharts = example({
    keywords: [
        "Plan", "chart", "Plan.series.chart", "Plan.line", "Plan.area", "Plan.column", "Plan.scatter", "Plan.band", "Plan.layer",
        "Plan.values", "Chart.refLine", "Chart.refBand", "combo", "combined", "legend", "tooltip", "readout", "colour", "color",
        "label", "unit", "curve", "monotoneX", "natural", "stepAfter", "step", "width", "dash", "dots", "opacity", "fillOpacity",
        "size", "stack", "stacked", "side by side", "order", "breach", "grid", "numTicks", "tickValues", "domain", "left", "right",
        "two axes", "dual axis", "target zone", "sparse", "gap", "scatter", "spark", "expandable", "expandedHeight", "Plan.fixed",
        "section", "Plan.series.section", "now", "planned", "rightAxis", "right axis", "rail", "#1753", "#1750",
    ],
    description: "A print works' chart rows over ten weeks, each styled its own way: columns under a smooth forecast in its range and a dashed target; halls' columns stacked under a dotted plan; jobs planned and done side by side, a breach in warn; stacked areas; an area on the left axis beside a stepped line on the right, their ticks shared; columns beside an on-time line with dots in its target zone; a sparse line whose lone readings draw as dots, on no gridlines; two scatters under a limit; every stroke and curve; six presses in a short row, its legend's last line saying how many more; sparks at a row's own height that open taller — each row's legend naming its series in their colours with their units, and hovering a week reading every series there; the right axes read their numbers in a rail after every row's plot (rightAxis), so every plot is one width",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The rows' readings, read whole.
            const measures = $.let(Data.bind(planChartMeasures));
            return <Plan
                axis={Plan.axis({
                    window: { min: new Date("2026-06-01T00:00:00Z"), max: new Date("2026-08-10T00:00:00Z") },
                    resolution: "week", resolutions: ["week", "month"], now: new Date("2026-07-13T00:00:00Z"),
                })}
                data={measures}
                // The right axes' numbers in a rail after every row's plot: every plot one width, down the page.
                rightAxis
                series={[
                    Plan.series.section(ChartMeasure, { key: "one-axis", title: "One axis" }, [
                        // A combo: the sheets printed as columns, the forecast a smooth line over its range — one series
                        // by its name, so one legend line and one colour — and the target a dashed red rule.
                        Plan.series.chart(ChartMeasure, {
                            key: "combo", title: "Combo",
                            match: (r) => r.chart.equal("combo"),
                            label: (r) => r.label,
                            height: Plan.fixed("120px"),
                            left: { label: "k sheets", numTicks: 4 },
                            layers: [
                                Plan.column(Plan.values("weeks", (w) => ({ y: w.get("Printed") })), { label: "Printed" }),
                                Plan.band(Plan.values("weeks", (w) => ({ lo: w.get("Low"), hi: w.get("High") })), { label: "Forecast", fillOpacity: 0.16, order: -1 }),
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Forecast") })), { label: "Forecast", curve: "monotoneX", width: 2 }),
                                Plan.layer(Chart.refLine({ y: 45, label: "TARGET 45" }), { color: "red.solid", dash: "6 4" }),
                            ],
                        }),
                        // The halls' columns stacked, one place a week, under the plan's dotted line — on a two-line gutter,
                        // the legend beneath its second line.
                        Plan.series.chart(ChartMeasure, {
                            key: "halls", title: "Halls",
                            match: (r) => r.chart.equal("halls"),
                            label: (r) => r.label, stacked: true, sub: (r) => r.sub,
                            height: Plan.fixed("140px"),
                            left: { label: "k sheets", numTicks: 4 },
                            layers: [
                                Plan.column(Plan.values("weeks", (w) => ({ y: w.get("Hall 1") })), { label: "Hall 1", stack: "halls" }),
                                Plan.column(Plan.values("weeks", (w) => ({ y: w.get("Hall 2") })), { label: "Hall 2", stack: "halls" }),
                                Plan.column(Plan.values("weeks", (w) => ({ y: w.get("Hall 3") })), { label: "Hall 3", stack: "halls" }),
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Plan") })), { label: "Plan", color: "fg.subtle", dash: "2 3", width: 1.5 }),
                            ],
                        }),
                        // Columns that share no stack stand side by side in their week: the plan in grey, what was done
                        // in the brand — a week done under 20 in warn.
                        Plan.series.chart(ChartMeasure, {
                            key: "jobs", title: "Jobs",
                            match: (r) => r.chart.equal("jobs"),
                            label: (r) => r.label,
                            height: "expanded",
                            left: { label: "jobs", numTicks: 3 },
                            layers: [
                                Plan.column(Plan.values("weeks", (w) => ({ y: w.get("Planned") })), { label: "Planned", color: "fg.subtle" }),
                                Plan.column(Plan.values("weeks", (w) => ({ y: w.get("Done") })), { label: "Done", color: "brand.solid", breach: { below: 20 } }),
                            ],
                        }),
                        // Areas that share a stack pile up, each filling from the one under it.
                        Plan.series.chart(ChartMeasure, {
                            key: "press-hours", title: "Press hours",
                            match: (r) => r.chart.equal("press-hours"),
                            label: (r) => r.label,
                            height: Plan.fixed("120px"),
                            left: { label: "h", numTicks: 4 },
                            layers: [
                                Plan.area(Plan.values("weeks", (w) => ({ y: w.get("Press A") })), { label: "Press A", stack: "presses", curve: "monotoneX", fillOpacity: 0.35 }),
                                Plan.area(Plan.values("weeks", (w) => ({ y: w.get("Press B") })), { label: "Press B", stack: "presses", curve: "monotoneX", fillOpacity: 0.35 }),
                                Plan.area(Plan.values("weeks", (w) => ({ y: w.get("Press C") })), { label: "Press C", stack: "presses", curve: "monotoneX", fillOpacity: 0.35 }),
                            ],
                        }),
                    ]),
                    Plan.series.section(ChartMeasure, { key: "two-axes", title: "Two axes" }, [
                        // The load on the left, 0–100 by 25; the temperature on the right, 0–40, reading its own number at
                        // each of the left's ticks — one set of gridlines for both. The legend names each series' axis.
                        Plan.series.chart(ChartMeasure, {
                            key: "climate", title: "Climate",
                            match: (r) => r.chart.equal("climate"),
                            label: (r) => r.label,
                            height: Plan.fixed("120px"),
                            left: { label: "%", domain: [0, 100], tickValues: [0, 25, 50, 75, 100] },
                            right: { label: "°C", domain: [0, 40] },
                            layers: [
                                Plan.area(Plan.values("weeks", (w) => ({ y: w.get("Load") })), { label: "Load", curve: "natural", fillOpacity: 0.2 }),
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Temp") })), { label: "Temp", axis: "right", curve: "stepAfter", color: "orange.solid", width: 2 }),
                            ],
                        }),
                        // The sheets as columns on the left, in thousands; the on-time line on the right, a dot at every
                        // week, over its target zone — a range of values on its axis, washed across the plot.
                        Plan.series.chart(ChartMeasure, {
                            key: "quality", title: "Quality",
                            match: (r) => r.chart.equal("quality"),
                            label: (r) => r.label,
                            height: Plan.fixed("120px"),
                            left: { label: "k", domain: [0, 60], tickValues: [0, 20, 40, 60] },
                            right: { label: "%", domain: [70, 100] },
                            layers: [
                                Plan.layer(Chart.refBand({ y: [92, 100], label: "ON TARGET" }), { color: "green.solid", axis: "right" }),
                                Plan.column(Plan.values("weeks", (w) => ({ y: w.get("Sheets") })), { label: "Sheets", fillOpacity: 0.85 }),
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("On-time") })), { label: "On-time", axis: "right", color: "green.solid", dots: true, width: 2 }),
                            ],
                        }),
                    ]),
                    Plan.series.section(ChartMeasure, { key: "points", title: "Points" }, [
                        // The audits break where a week held none, and a reading with none either side draws as its dot;
                        // the average runs dashed beneath. Its numbers read its scale, with no gridlines.
                        Plan.series.chart(ChartMeasure, {
                            key: "audits", title: "Audits",
                            match: (r) => r.chart.equal("audits"),
                            label: (r) => r.label,
                            height: "expanded",
                            grid: false,
                            left: { label: "%", numTicks: 3 },
                            layers: [
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Audit") })), { label: "Audit", color: "purple.solid", width: 2 }),
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Average") })), { label: "Average", color: "fg.subtle", dash: "6 4", width: 1 }),
                            ],
                        }),
                        // Two presses' defects as dots, each of its own size and colour, under a limit.
                        Plan.series.chart(ChartMeasure, {
                            key: "defects", title: "Defects",
                            match: (r) => r.chart.equal("defects"),
                            label: (r) => r.label,
                            height: Plan.fixed("120px"),
                            left: { label: "ppm", numTicks: 3 },
                            layers: [
                                Plan.scatter(Plan.values("weeks", (w) => ({ y: w.get("Press A") })), { label: "Press A", color: "teal.solid", size: 4.5 }),
                                Plan.scatter(Plan.values("weeks", (w) => ({ y: w.get("Press B") })), { label: "Press B", color: "orange.solid", size: 3, opacity: 0.8 }),
                                Plan.layer(Chart.refLine({ y: 160, label: "LIMIT 160" }), { color: "red.solid" }),
                            ],
                        }),
                    ]),
                    Plan.series.section(ChartMeasure, { key: "styles", title: "Line styles" }, [
                        // Every stroke: the default, a thick one, a dashed one, a dotted one with a dot at every point, and
                        // a faint one.
                        Plan.series.chart(ChartMeasure, {
                            key: "strokes", title: "Strokes",
                            match: (r) => r.chart.equal("strokes"),
                            label: (r) => r.label,
                            height: Plan.fixed("160px"),
                            layers: [
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Default") })), { label: "Default" }),
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Thick") })), { label: "Thick", width: 3.5 }),
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Dashed") })), { label: "Dashed", dash: "8 4", width: 2 }),
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Dotted") })), { label: "Dotted", dash: "1 3", width: 2, dots: true }),
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Faint") })), { label: "Faint", width: 2, opacity: 0.4 }),
                            ],
                        }),
                        // One zigzag joined four ways.
                        Plan.series.chart(ChartMeasure, {
                            key: "curves", title: "Curves",
                            match: (r) => r.chart.equal("curves"),
                            label: (r) => r.label,
                            height: Plan.fixed("140px"),
                            layers: [
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Linear") })), { label: "Linear", width: 2 }),
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Smooth") })), { label: "Smooth", curve: "monotoneX", width: 2 }),
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Natural") })), { label: "Natural", curve: "natural", width: 2 }),
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Step") })), { label: "Step", curve: "stepAfter", width: 2 }),
                            ],
                        }),
                        // Six presses in a row with room to list one: its legend's last line says how many more there
                        // are, and hovering a week reads all six.
                        Plan.series.chart(ChartMeasure, {
                            key: "presses", title: "Presses",
                            match: (r) => r.chart.equal("presses"),
                            label: (r) => r.label,
                            height: "expanded",
                            left: { label: "k sheets", numTicks: 3 },
                            layers: [
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Press A") })), { label: "Press A" }),
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Press B") })), { label: "Press B" }),
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Press C") })), { label: "Press C" }),
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Press D") })), { label: "Press D" }),
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Press E") })), { label: "Press E" }),
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("Press F") })), { label: "Press F" }),
                            ],
                        }),
                    ]),
                    Plan.series.section(ChartMeasure, { key: "sparks", title: "Sparks" }, [
                        // A spark reads its scale by its gridlines alone and lists no series; its caret opens it taller,
                        // where it does both.
                        Plan.series.chart(ChartMeasure, {
                            key: "spark-line", title: "Spark line",
                            match: (r) => r.chart.equal("spark-line"),
                            label: (r) => r.label, value: (r) => r.value,
                            expandable: true, expandedHeight: "120px",
                            left: { label: "%", numTicks: 3 },
                            layers: [
                                Plan.line(Plan.values("weeks", (w) => ({ y: w.get("On-time") })), { label: "On-time", color: "teal.solid", breach: { below: 92 } }),
                                Plan.layer(Chart.refLine({ y: 92, label: "FLOOR 92" }), { dash: "2 3" }),
                            ],
                        }),
                        Plan.series.chart(ChartMeasure, {
                            key: "spark-columns", title: "Spark columns",
                            match: (r) => r.chart.equal("spark-columns"),
                            label: (r) => r.label, value: (r) => r.value,
                            expandable: true, expandedHeight: "120px",
                            left: { label: "k sheets", numTicks: 3 },
                            layers: [Plan.column(Plan.values("weeks", (w) => ({ y: w.get("Printed") })), { label: "Printed" })],
                        }),
                    ]),
                ]} />;
        }}</Reactive>
    )),
    inputs: [],
});
