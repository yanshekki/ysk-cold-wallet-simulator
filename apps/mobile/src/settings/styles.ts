import { StyleSheet } from 'react-native';
import { colors, fonts, hairline, radius, space } from '@cws/ui';

export const settingsStyles = StyleSheet.create({
  section: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginTop: space.sm,
  },
  row: {
    flexDirection: 'row',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  link: {
    minHeight: 48,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
  },
  linkLabel: {
    color: colors.text,
    fontFamily: fonts.sansSemi,
    fontSize: 15,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  label: {
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 14,
    flex: 1,
  },
  meta: {
    color: colors.muted,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
  },
  pathRow: {
    gap: 4,
  },
  pathHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pathLabel: {
    color: colors.text,
    fontFamily: fonts.sansSemi,
    fontSize: 13,
    flex: 1,
  },
  input: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: space.md,
    minHeight: 40,
    fontFamily: fonts.mono,
    fontSize: 12,
  },
  card: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
    padding: space.md,
    gap: space.sm,
  },
  cardTitle: {
    color: colors.text,
    fontFamily: fonts.sansSemi,
    fontSize: 15,
  },
  dangerTitle: {
    color: colors.danger,
  },
  chip: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: {
    borderColor: colors.ok,
    backgroundColor: colors.bgElevated,
  },
  chipLabel: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    fontSize: 12,
  },
  chipLabelOn: {
    color: colors.ok,
  },
});
