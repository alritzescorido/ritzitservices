import 'dart:async';

import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../api/models.dart';
import '../../ui.dart';

/// Type-ahead over /locations/search. Shows the chosen place with a "change" link.
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
  Timer? _debounce;

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
        final r = await Api.searchLocations(q.trim(), level: widget.level);
        if (mounted) setState(() => _hits = r);
      } catch (_) {
        if (mounted) setState(() => _hits = const []);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final v = widget.value;
    if (v != null) {
      return InputDecorator(
        decoration: InputDecoration(labelText: widget.label),
        child: Row(children: [
          Expanded(child: Text(v.displayName)),
          TextButton(onPressed: () => widget.onChanged(null), child: const Text('change')),
        ]),
      );
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TextField(controller: _q, onChanged: _search, decoration: InputDecoration(labelText: widget.label, hintText: 'Type the name…')),
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
                    _q.clear();
                    setState(() => _hits = const []);
                    widget.onChanged(h);
                  },
                ),
            ],
          ),
        ),
    ]);
  }
}
