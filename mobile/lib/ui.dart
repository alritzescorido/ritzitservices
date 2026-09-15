import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'api/client.dart';

// Palette shared with the console and web app: warm paper, deep green ink.
const kAccent = Color(0xFF2E7D4F);
const kWarn = Color(0xFFB4572E);
const kBg = Color(0xFFF5F6F2);

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: kAccent, primary: kAccent, error: kWarn, surface: Colors.white);
  return ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: kBg,
    useMaterial3: true,
    inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder(), isDense: false, contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 14)),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48), textStyle: const TextStyle(fontWeight: FontWeight.w600))),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48))),
    cardTheme: const CardThemeData(elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(10)), side: BorderSide(color: Color(0xFFD5DAD3))), margin: EdgeInsets.only(bottom: 10)),
  );
}

final _peso = NumberFormat.currency(locale: 'en_PH', symbol: '₱', decimalDigits: 2);
final _dateTime = DateFormat('d MMM yyyy, h:mm a');
final _dateOnly = DateFormat('d MMM yyyy');

String money(String? v) {
  if (v == null || v.isEmpty) return '—';
  final n = double.tryParse(v);
  return n == null ? v : _peso.format(n);
}

String when(String? iso) {
  if (iso == null) return '—';
  final d = DateTime.tryParse(iso)?.toLocal();
  return d == null ? iso : _dateTime.format(d);
}

String day(String? ymd) {
  if (ymd == null) return '—';
  final d = DateTime.tryParse(ymd);
  return d == null ? ymd : _dateOnly.format(d);
}

String unitLabel(String unit) => unit == 'per_head' ? '/ulo' : '/kg';

String errorText(Object e) => e is ApiException ? e.message : e.toString().replaceFirst('Exception: ', '');

void showError(BuildContext context, Object e) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(e)), backgroundColor: kWarn));
}

void showNote(BuildContext context, String text) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
}

class StatusPill extends StatelessWidget {
  const StatusPill(this.text, {super.key, this.tone = 'muted'});
  final String text;
  final String tone; // ok | warn | info | muted
  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (tone) {
      'ok' => (const Color(0xFFE4F0E8), kAccent),
      'warn' => (const Color(0xFFF6E7DF), kWarn),
      'info' => (const Color(0xFFE3EBF3), const Color(0xFF1B2320)),
      _ => (const Color(0xFFE9ECE6), const Color(0xFF5D6963)),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 2),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Text(text, style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}

class Muted extends StatelessWidget {
  const Muted(this.text, {super.key, this.size = 13});
  final String text;
  final double size;
  @override
  Widget build(BuildContext context) => Text(text, style: TextStyle(color: const Color(0xFF5D6963), fontSize: size));
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 14, bottom: 6),
        child: Text(text.toUpperCase(), style: const TextStyle(fontSize: 12, letterSpacing: 1, color: Color(0xFF5D6963), fontWeight: FontWeight.w600)),
      );
}

class Note extends StatelessWidget {
  const Note(this.text, {super.key, this.warn = false});
  final String text;
  final bool warn;
  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: warn ? const Color(0xFFF6E7DF) : const Color(0xFFE3EBF3), borderRadius: BorderRadius.circular(8)),
        child: Text(text, style: TextStyle(fontSize: 14, color: warn ? kWarn : null)),
      );
}

/// Padded card body with an optional title, matching the web app's cards.
class Panel extends StatelessWidget {
  const Panel({super.key, this.title, required this.child, this.onTap});
  final String? title;
  final Widget child;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Card(
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (title != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(title!, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600))),
              child,
            ]),
          ),
        ),
      );
}

class EmptyText extends StatelessWidget {
  const EmptyText(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.symmetric(vertical: 24), child: Center(child: Muted(text, size: 14)));
}
