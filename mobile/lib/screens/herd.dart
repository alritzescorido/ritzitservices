import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../api/api.dart';
import '../api/client.dart';
import '../api/models.dart';
import '../ui.dart';
import 'widgets/location_picker.dart';

/// Wireframe Herd: farms and their lots; add a farm, add a lot with a photo.
class HerdScreen extends StatefulWidget {
  const HerdScreen({super.key});
  @override
  State<HerdScreen> createState() => _HerdScreenState();
}

class _HerdScreenState extends State<HerdScreen> {
  List<Farm>? _farms;
  final Map<String, List<Lot>> _lots = {};
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final farms = await Api.farms();
      final lots = <String, List<Lot>>{};
      for (final f in farms) {
        lots[f.id] = await Api.lots(f.id);
      }
      if (!mounted) return;
      setState(() {
        _farms = farms;
        _lots
          ..clear()
          ..addAll(lots);
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    }
  }

  Future<void> _addFarm() async {
    final ok = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (_) => const _FarmSheet());
    if (ok == true) _load();
  }

  Future<void> _addLot(Farm f) async {
    final ok = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (_) => _LotSheet(farm: f));
    if (ok == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final farms = _farms;
    return Scaffold(
      appBar: AppBar(title: const Text('Mga hayop ko'), actions: [TextButton.icon(onPressed: _addFarm, icon: const Icon(Icons.add), label: const Text('Farm'))]),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_error != null) Note(_error!, warn: true),
            if (farms == null) const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
            if (farms != null && farms.isEmpty) const EmptyText('No farm yet. Add one to start listing animals.'),
            for (final f in farms ?? const <Farm>[])
              Panel(
                title: f.name,
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Muted('${f.location.displayName} · ${f.farmType ?? 'farm'}'),
                  const SizedBox(height: 8),
                  for (final l in _lots[f.id] ?? const <Lot>[])
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(children: [
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${speciesLabel[l.species] ?? l.species} × ${l.headCount}', style: const TextStyle(fontWeight: FontWeight.w600)),
                            Muted('${l.weightClass.label}${l.avgWeightKg != null ? ' · avg ${l.avgWeightKg} kg' : ''}${l.breed != null ? ' · ${l.breed}' : ''}'),
                          ]),
                        ),
                        if (l.photoKeys.isNotEmpty) StatusPill('${l.photoKeys.length} photo'),
                      ]),
                    ),
                  if ((_lots[f.id] ?? const []).isEmpty) const Muted('No lots yet.'),
                  const SizedBox(height: 6),
                  OutlinedButton.icon(onPressed: () => _addLot(f), icon: const Icon(Icons.add), label: const Text('Lot')),
                ]),
              ),
          ],
        ),
      ),
    );
  }
}

class _FarmSheet extends StatefulWidget {
  const _FarmSheet();
  @override
  State<_FarmSheet> createState() => _FarmSheetState();
}

class _FarmSheetState extends State<_FarmSheet> {
  final _name = TextEditingController();
  Location? _brgy;
  String _type = 'backyard';
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('New farm', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
        const SizedBox(height: 12),
        TextField(controller: _name, decoration: const InputDecoration(labelText: 'Name'), onChanged: (_) => setState(() {})),
        const SizedBox(height: 12),
        LocationPicker(level: 'barangay', label: 'Barangay', value: _brgy, onChanged: (l) => setState(() => _brgy = l)),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          initialValue: _type,
          decoration: const InputDecoration(labelText: 'Type'),
          items: const [DropdownMenuItem(value: 'backyard', child: Text('Backyard')), DropdownMenuItem(value: 'commercial', child: Text('Commercial')), DropdownMenuItem(value: 'cooperative', child: Text('Cooperative'))],
          onChanged: (v) => setState(() => _type = v ?? 'backyard'),
        ),
        const SizedBox(height: 14),
        FilledButton(
          onPressed: _busy || _name.text.trim().length < 2 || _brgy == null
              ? null
              : () async {
                  setState(() => _busy = true);
                  try {
                    await Api.createFarm(_name.text.trim(), _brgy!.code, _type);
                    if (context.mounted) Navigator.pop(context, true);
                  } catch (e) {
                    if (context.mounted) showError(context, e);
                  } finally {
                    if (mounted) setState(() => _busy = false);
                  }
                },
          child: Text(_busy ? 'Saving…' : 'Save farm'),
        ),
      ]),
    );
  }
}

class _LotSheet extends StatefulWidget {
  const _LotSheet({required this.farm});
  final Farm farm;
  @override
  State<_LotSheet> createState() => _LotSheetState();
}

class _LotSheetState extends State<_LotSheet> {
  String _species = 'hog';
  final _heads = TextEditingController();
  final _avg = TextEditingController();
  final _breed = TextEditingController();
  XFile? _photo;
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('New lot at ${widget.farm.name}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _species,
            decoration: const InputDecoration(labelText: 'Species'),
            items: [for (final s in speciesAll) DropdownMenuItem(value: s, child: Text(speciesLabel[s]!))],
            onChanged: (v) => setState(() => _species = v ?? 'hog'),
          ),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: TextField(controller: _heads, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Heads'), onChanged: (_) => setState(() {}))),
            const SizedBox(width: 10),
            Expanded(child: TextField(controller: _avg, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Avg weight, kg', helperText: 'Sets the weight class'))),
          ]),
          const SizedBox(height: 12),
          TextField(controller: _breed, decoration: const InputDecoration(labelText: 'Breed (optional)')),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: () async {
              final f = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1600, imageQuality: 85);
              if (f != null) setState(() => _photo = f);
            },
            icon: const Icon(Icons.photo_camera_outlined),
            label: Text(_photo == null ? 'Photo (optional)' : 'Photo taken, retake'),
          ),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: _busy || int.tryParse(_heads.text) == null
                ? null
                : () async {
                    setState(() => _busy = true);
                    try {
                      final keys = <String>[];
                      if (_photo != null) keys.add(await ApiClient.instance.upload('lot_photo', await _photo!.readAsBytes(), 'image/jpeg'));
                      await Api.createLot(widget.farm.id, {
                        'species': _species,
                        'head_count': int.parse(_heads.text),
                        'avg_weight_kg': _avg.text.trim().isEmpty ? null : _avg.text.trim(),
                        'breed': _breed.text.trim().isEmpty ? null : _breed.text.trim(),
                        'photo_keys': keys,
                      });
                      if (context.mounted) Navigator.pop(context, true);
                    } catch (e) {
                      if (context.mounted) showError(context, e);
                    } finally {
                      if (mounted) setState(() => _busy = false);
                    }
                  },
            child: Text(_busy ? 'Saving…' : 'Save lot'),
          ),
        ]),
      ),
    );
  }
}
