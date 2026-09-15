import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../ui.dart';
import 'widgets/location_picker.dart';

/// Wireframe Main: the running price per weight class for my municipality,
/// with its source and sample size on every row. The last good board is kept
/// on the phone so it still shows in the field without signal.
class BoardScreen extends StatefulWidget {
  const BoardScreen({super.key});
  @override
  State<BoardScreen> createState() => _BoardScreenState();
}

class _BoardScreenState extends State<BoardScreen> {
  Location? _home;
  Board? _board;
  String _species = '';
  bool _loading = false;
  bool _offline = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    final prefs = await SharedPreferences.getInstance();
    final home = prefs.getString('home');
    final cached = prefs.getString('board');
    if (home != null) _home = Location.fromJson(jsonDecode(home) as Map<String, dynamic>);
    if (cached != null) _board = Board.fromJson(jsonDecode(cached) as Map<String, dynamic>);
    if (_home == null) {
      // First run: take the municipality from the first farm.
      try {
        final farms = await Api.farms();
        final muni = farms.isEmpty ? null : farms.first.location.municipality;
        if (muni != null) await _setHome(Location.fromJson({...muni.toJson(), 'display_name': farms.first.location.displayName.split(', ').skip(1).join(', ')}));
      } catch (_) {}
    }
    if (mounted) setState(() {});
    await _load();
  }

  Future<void> _setHome(Location? l) async {
    final prefs = await SharedPreferences.getInstance();
    if (l == null) {
      await prefs.remove('home');
    } else {
      await prefs.setString('home', jsonEncode(l.toJson()));
    }
    if (mounted) setState(() => _home = l);
    await _load();
  }

  Future<void> _load() async {
    final h = _home;
    if (h == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final b = await Api.board(h.code, species: _species.isEmpty ? null : _species);
      if (!mounted) return;
      setState(() {
        _board = b;
        _offline = false;
      });
      if (_species.isEmpty) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('board', jsonEncode(_boardJson(b)));
      }
    } catch (e) {
      if (!mounted) return;
      if (_board != null && _board!.municipality.code == h.code) {
        setState(() => _offline = true);
      } else {
        setState(() => _error = errorText(e));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Re-serialise the board for the offline copy (models do not keep the raw JSON).
  Map<String, dynamic> _boardJson(Board b) => {
        'municipality': b.municipality.toJson(),
        'province': b.province?.toJson(),
        'as_of': b.asOf,
        'items': [
          for (final r in b.items)
            {
              'species': r.species,
              'weight_class': {'id': r.weightClass.id, 'label': r.weightClass.label, 'unit': r.weightClass.unit},
              'unit': r.unit,
              'source': r.source,
              'location_name': r.locationName,
              'median_price': r.median,
              'low_price': r.low,
              'high_price': r.high,
              'sample_count': r.sampleCount,
              'change_30d_pct': r.change30d,
              'reference_source': r.referenceSource,
              'sparkline': r.sparkline,
            }
        ],
      };

  @override
  Widget build(BuildContext context) {
    final b = _board;
    final rows = (b?.items ?? const <BoardRow>[]).where((r) => _species.isEmpty || r.species == _species).toList();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Presyo ngayon'),
        actions: [if (_home != null) TextButton(onPressed: () => _setHome(null), child: const Text('bayan'))],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_home == null)
              Panel(title: 'Saang bayan?', child: LocationPicker(level: 'municipality', label: 'Municipality or city', value: null, onChanged: _setHome))
            else
              Muted('${_home!.displayName}${b != null ? ' · as of ${day(b.asOf)}' : ''}', size: 14),
            if (_offline) const Note('Offline. Showing the last saved board.'),
            if (_error != null) Note(_error!, warn: true),
            const SizedBox(height: 8),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(children: [
                ChoiceChip(label: const Text('Lahat'), selected: _species.isEmpty, onSelected: (_) => _pickSpecies('')),
                for (final s in speciesAll) ...[
                  const SizedBox(width: 6),
                  ChoiceChip(label: Text(speciesLabel[s]!), selected: _species == s, onSelected: (_) => _pickSpecies(s)),
                ],
              ]),
            ),
            const SizedBox(height: 10),
            if (_loading && b == null) const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
            if (b != null && rows.isEmpty) const EmptyText('No prices yet for this selection.'),
            for (final r in rows) _BoardCard(r),
            if (b != null) const Padding(padding: EdgeInsets.only(top: 8), child: Muted('Median of settled deals in the last 7 days. A municipality needs 5 sales before it shows its own price; otherwise the province, then the PSA reference.')),
          ],
        ),
      ),
    );
  }

  void _pickSpecies(String s) {
    setState(() => _species = s);
    _load();
  }
}

class _BoardCard extends StatelessWidget {
  const _BoardCard(this.r);
  final BoardRow r;
  @override
  Widget build(BuildContext context) {
    final src = switch (r.source) {
      'municipality' => '${r.sampleCount} sales in ${r.locationName}',
      'province' => '${r.sampleCount} sales across ${r.locationName}',
      _ => 'reference price${r.referenceSource != null ? ', ${r.referenceSource}' : ''}',
    };
    final band = r.low != null && r.high != null && r.source != 'reference' ? ' · ${money(r.low)} to ${money(r.high)}' : '';
    final change = r.change30d;
    final pts = r.sparkline.whereType<double>().toList();
    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text('${speciesLabel[r.species] ?? r.species} · ${r.weightClass.label}', style: const TextStyle(fontWeight: FontWeight.w600)),
          StatusPill(r.source == 'municipality' ? 'live, this town' : r.source == 'province' ? 'live, province' : 'reference', tone: r.source == 'municipality' ? 'ok' : r.source == 'province' ? 'info' : 'muted'),
        ]),
        const SizedBox(height: 4),
        // A price board must never show a bare dash where a number belongs.
        if (r.median == null)
          const Muted('Wala pang presyo para sa klaseng ito. No price set for this class yet.', size: 14)
        else ...[
          Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text(money(r.median), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700)),
            const SizedBox(width: 6),
            Muted(unitLabel(r.unit)),
            const SizedBox(width: 10),
            if (change != null && change != 0) Text('${change > 0 ? '▲' : '▼'} ${change.abs().toStringAsFixed(1)}% 30d', style: TextStyle(fontSize: 13, color: change > 0 ? kAccent : kWarn)),
          ]),
          Muted('$src$band'),
        ],
        if (pts.length > 1) Padding(padding: const EdgeInsets.only(top: 6), child: SizedBox(height: 28, child: CustomPaint(painter: _Spark(r.sparkline)))),
      ]),
    );
  }
}

class _Spark extends CustomPainter {
  _Spark(this.pts);
  final List<double?> pts;
  @override
  void paint(Canvas canvas, Size size) {
    final vals = pts.whereType<double>().toList();
    if (vals.length < 2) return;
    final min = vals.reduce((a, b) => a < b ? a : b);
    final max = vals.reduce((a, b) => a > b ? a : b);
    final w = size.width / pts.length;
    final paint = Paint()..color = kAccent.withValues(alpha: 0.55);
    for (var i = 0; i < pts.length; i++) {
      final v = pts[i];
      final h = v == null ? 2.0 : max == min ? 14.0 : 4 + (v - min) / (max - min) * 24;
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(i * w + 1, size.height - h, w - 2, h), const Radius.circular(2)), v == null ? (Paint()..color = kAccent.withValues(alpha: 0.15)) : paint);
    }
  }

  @override
  bool shouldRepaint(covariant _Spark old) => old.pts != pts;
}
