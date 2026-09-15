import 'dart:async';

import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../api/models.dart';
import '../../ui.dart';

/// Picks a place. Municipalities are searched by name, which is distinctive.
/// Barangays are picked in two steps, because hundreds of barangays share a
/// name: "Poblacion" alone cannot find the one in Lake Sebu, so the town comes
/// first and its barangays are then listed in full.
class LocationPicker extends StatefulWidget {
  const LocationPicker({super.key, required this.level, required this.label, required this.value, required this.onChanged});
  final String level; // municipality | barangay
  final String label;
  final Location? value;
  final void Function(Location?) onChanged;
  @override
  State<LocationPicker> createState() => _LocationPickerState();
}

class _LocationPickerState extends State<LocationPicker> {
  final _q = TextEditingController();
  List<Location> _hits = const [];
  Location? _town;
  List<Location>? _barangays;
  Timer? _debounce;

  bool get _twoStep => widget.level == 'barangay';

  @override
  void dispose() {
    _debounce?.cancel();
    _q.dispose();
    super.dispose();
  }

  void _search(String q) {
    _debounce?.cancel();
    if (q.trim().length < 2) {
      setState(() => _hits = const []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 250), () async {
      try {
        final r = await Api.searchLocations(q.trim(), level: _twoStep ? 'municipality' : widget.level);
        if (mounted) setState(() => _hits = r);
      } catch (_) {
        if (mounted) setState(() => _hits = const []);
      }
    });
  }

  Future<void> _pickTown(Location t) async {
    _q.clear();
    setState(() {
      _town = t;
      _hits = const [];
      _barangays = null;
    });
    try {
      final b = await Api.children(t.code);
      if (mounted) setState(() => _barangays = b);
    } catch (_) {
      if (mounted) setState(() => _barangays = const []);
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = widget.value;
    if (v != null) {
      return InputDecorator(
        decoration: InputDecoration(labelText: widget.label),
        child: Row(children: [
          Expanded(child: Text(v.displayName)),
          TextButton(
            onPressed: () {
              setState(() => _town = null);
              widget.onChanged(null);
            },
            child: const Text('change'),
          ),
        ]),
      );
    }

    // Step two: the town is chosen, list its barangays.
    final town = _town;
    if (_twoStep && town != null) {
      final brgys = _barangays;
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        InputDecorator(
          decoration: const InputDecoration(labelText: 'Town or city'),
          child: Row(children: [
            Expanded(child: Text(town.displayName)),
            TextButton(onPressed: () => setState(() => _town = null), child: const Text('change')),
          ]),
        ),
        const SizedBox(height: 10),
        if (brgys == null)
          const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Muted('Loading barangays…'))
        else if (brgys.isEmpty)
          const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Muted('No barangays listed for this town.'))
        else
          DropdownButtonFormField<Location>(
            decoration: InputDecoration(labelText: '${widget.label} (${brgys.length})'),
            isExpanded: true,
            items: [for (final b in brgys) DropdownMenuItem(value: b, child: Text(b.name))],
            // GET /locations?parent= returns bare rows with no display_name or
            // path, so build both from the town already chosen. Otherwise the
            // picked barangay shows without its town and province.
            onChanged: (b) => widget.onChanged(b?.under(town)),
          ),
      ]);
    }

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TextField(
        controller: _q,
        onChanged: _search,
        decoration: InputDecoration(
          labelText: _twoStep ? 'Town or city' : widget.label,
          hintText: 'Type the name…',
          helperText: _twoStep ? 'Search your town first, then pick the barangay.' : null,
        ),
      ),
      if (_hits.isNotEmpty)
        Card(
          margin: const EdgeInsets.only(top: 4),
          child: Column(
            children: [
              for (final h in _hits)
                ListTile(
                  dense: true,
                  title: Text(h.displayName),
                  trailing: Muted(h.level),
                  onTap: () {
                    if (_twoStep) {
                      _pickTown(h);
                    } else {
                      _q.clear();
                      setState(() => _hits = const []);
                      widget.onChanged(h);
                    }
                  },
                ),
            ],
          ),
        ),
    ]);
  }
}
