import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';

import '../api/api.dart';
import '../api/client.dart';
import '../api/models.dart';
import '../ui.dart';

/// Wireframes HaulPickup and HaulTransit.
///
/// The pickup checklist is the point of the whole phase: the permit number, the
/// vet certificate number, the head count and a photo of the load are what make
/// a later dispute decidable. The trip cannot start until all four are present,
/// and that rule is enforced by the server as well as by this button.
const _tone = {'assigned': 'info', 'picked_up': 'info', 'in_transit': 'info', 'delivered': 'ok', 'cancelled': 'muted'};

class TripsScreen extends StatefulWidget {
  const TripsScreen({super.key});
  @override
  State<TripsScreen> createState() => _TripsScreenState();
}

class _TripsScreenState extends State<TripsScreen> {
  List<Shipment>? _items;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Api.shipments();
      if (mounted) {
        setState(() {
          _items = r;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return Scaffold(
      appBar: AppBar(title: const Text('Mga biyahe')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_error != null) Note(_error!, warn: true),
            if (items == null) const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
            if (items != null && items.isEmpty) const EmptyText('No trips yet. Take a job under Trabaho.'),
            for (final s in items ?? const <Shipment>[])
              Panel(
                onTap: () async {
                  await Navigator.push(context, MaterialPageRoute(builder: (_) => TripDetailScreen(id: s.id)));
                  await _load();
                },
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                    Expanded(child: Text('${s.heads} ${speciesLabel[s.species] ?? s.species} · ${s.farmName}', style: const TextStyle(fontWeight: FontWeight.w600))),
                    StatusPill(s.status.replaceAll('_', ' '), tone: _tone[s.status] ?? 'muted'),
                  ]),
                  Muted([
                    s.pickup.displayName,
                    if (s.dropoff != null) '→ ${s.dropoff!.displayName}',
                    if (s.status == 'assigned') 'pickup ${when(s.scheduledPickupAt)}' else if (s.status == 'delivered') 'handed over ${when(s.deliveredAt)}' else 'loaded ${when(s.pickedUpAt)}',
                    if (s.agreedFee != null) 'fee ${money(s.agreedFee)}',
                  ].join(' · ')),
                ]),
              ),
          ],
        ),
      ),
    );
  }
}

class TripDetailScreen extends StatefulWidget {
  const TripDetailScreen({super.key, required this.id});
  final String id;
  @override
  State<TripDetailScreen> createState() => _TripDetailScreenState();
}

class _TripDetailScreenState extends State<TripDetailScreen> {
  Shipment? _s;
  bool _busy = false;
  bool _sharing = false;
  Timer? _pings;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _pings?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final s = await Api.shipment(widget.id);
      if (mounted) setState(() => _s = s);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _run(Future<void> Function() fn, {String? done}) async {
    setState(() => _busy = true);
    try {
      await fn();
      if (done != null && mounted) showNote(context, done);
      await _load();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Asks once, then returns null rather than blocking the trip if refused: a
  /// hauler without location must still be able to record a pickup.
  Future<Position?> _here() async {
    try {
      var p = await Geolocator.checkPermission();
      if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
      if (p == LocationPermission.denied || p == LocationPermission.deniedForever) return null;
      return await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium, timeLimit: Duration(seconds: 12)));
    } catch (_) {
      return null;
    }
  }

  Future<void> _toggleSharing(bool on) async {
    _pings?.cancel();
    if (!on) {
      setState(() => _sharing = false);
      return;
    }
    final first = await _here();
    if (first == null) {
      if (mounted) showNote(context, 'Location is off, so the farmer and buyer cannot follow the trip.');
      return;
    }
    setState(() => _sharing = true);
    await Api.ping(widget.id, first.latitude, first.longitude).catchError((_) {});
    _pings = Timer.periodic(const Duration(minutes: 2), (_) async {
      final p = await _here();
      if (p != null) await Api.ping(widget.id, p.latitude, p.longitude).catchError((_) {});
    });
  }

  Future<void> _flag(String kind, String prompt) async {
    final note = await _ask(prompt);
    if (note == null) return;
    final p = await _here();
    await _run(() => Api.ping(widget.id, p?.latitude ?? 0, p?.longitude ?? 0, kind: kind, note: note), done: 'Told the farmer and buyer.');
  }

  Future<String?> _ask(String label) => showDialog<String>(
        context: context,
        builder: (ctx) {
          final c = TextEditingController();
          return AlertDialog(
            title: Text(label),
            content: TextField(controller: c, autofocus: true, maxLines: 2),
            actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Back')), FilledButton(onPressed: () => Navigator.pop(ctx, c.text.trim()), child: const Text('Send'))],
          );
        },
      );

  @override
  Widget build(BuildContext context) {
    final s = _s;
    if (s == null) return Scaffold(appBar: AppBar(title: const Text('Biyahe')), body: const Center(child: CircularProgressIndicator()));
    return Scaffold(
      appBar: AppBar(title: Text('${s.heads} ${speciesLabel[s.species] ?? s.species}')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Panel(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                  StatusPill(s.status.replaceAll('_', ' '), tone: _tone[s.status] ?? 'muted'),
                  Muted('deal ${s.dealState.replaceAll('_', ' ')}'),
                ]),
                const SizedBox(height: 8),
                _fact('Kunin sa', '${s.farmName}, ${s.pickup.displayName}'),
                _fact('Ihatid sa', s.dropoff?.displayName ?? 'to be arranged'),
                _fact('Oras', when(s.scheduledPickupAt)),
                _fact('Bayad', money(s.agreedFee)),
                _fact('Mga tao', '${s.farmerName} → ${s.buyerName}'),
                if (s.shippingPermitNo != null) _fact('Papeles', 'permit ${s.shippingPermitNo} · vet ${s.vetHealthCertNo} · ${s.headCountAtPickup} heads loaded ${when(s.pickedUpAt)}'),
              ]),
            ),
            if (s.status == 'assigned') _Checklist(s: s, busy: _busy, here: _here, onStart: (v) => _run(() => Api.startTrip(widget.id, v), done: 'Trip started. Drive safe.'), onWithdraw: (r) => _run(() => Api.cancelShipment(widget.id, r))),
            if (s.onTheRoad)
              Panel(
                title: 'Nasa biyahe',
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Share my position', style: TextStyle(fontSize: 15)),
                    subtitle: const Muted('Every 2 minutes, so the farmer and buyer can follow the truck.'),
                    value: _sharing,
                    onChanged: _busy ? null : _toggleSharing,
                  ),
                  const SizedBox(height: 4),
                  Row(children: [
                    Expanded(child: OutlinedButton(onPressed: _busy ? null : () => _flag('checkpoint', 'Checkpoint'), child: const Text('Checkpoint'))),
                    const SizedBox(width: 8),
                    Expanded(child: OutlinedButton(onPressed: _busy ? null : () => _flag('delay', 'What is the delay?'), child: const Text('Delay'))),
                    const SizedBox(width: 8),
                    Expanded(child: OutlinedButton(onPressed: _busy ? null : () => _flag('problem', 'What happened?'), child: const Text('Problema', style: TextStyle(color: kWarn)))),
                  ]),
                  const Divider(height: 24),
                  _Handover(busy: _busy, here: _here, onDone: (v) => _run(() => Api.markDelivered(widget.id, v), done: 'Handed over. The buyer confirms the count.')),
                ]),
              ),
            if (s.status == 'delivered') Note('Handed over ${when(s.deliveredAt)}. The buyer confirms the count and weight; your fee is settled with them directly.'),
            const SectionTitle('Timeline'),
            for (final e in s.events)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.circle, size: 10, color: kAccent),
                title: Text('${e.kind ?? e.status}${e.note != null ? ' · ${e.note}' : ''}', style: const TextStyle(fontSize: 14)),
                subtitle: Muted('${when(e.createdAt)}${e.lat != null ? ' · ${e.lat!.toStringAsFixed(4)}, ${e.lng!.toStringAsFixed(4)}' : ''}'),
              ),
          ],
        ),
      ),
    );
  }

  Widget _fact(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [SizedBox(width: 90, child: Muted(k, size: 14)), Expanded(child: Text(v, style: const TextStyle(fontSize: 14)))]),
      );
}

class _Checklist extends StatefulWidget {
  const _Checklist({required this.s, required this.busy, required this.here, required this.onStart, required this.onWithdraw});
  final Shipment s;
  final bool busy;
  final Future<Position?> Function() here;
  final void Function(Map<String, dynamic>) onStart;
  final void Function(String) onWithdraw;
  @override
  State<_Checklist> createState() => _ChecklistState();
}

class _ChecklistState extends State<_Checklist> {
  final _permit = TextEditingController();
  final _vet = TextEditingController();
  late final _heads = TextEditingController(text: '${widget.s.heads}');
  final List<String> _photos = [];
  bool _uploading = false;

  bool get _complete => _permit.text.trim().length >= 3 && _vet.text.trim().length >= 3 && (int.tryParse(_heads.text) ?? 0) >= 1 && _photos.isNotEmpty;

  Future<void> _addPhoto() async {
    final f = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1600, imageQuality: 85);
    if (f == null) return;
    setState(() => _uploading = true);
    try {
      final key = await ApiClient.instance.upload('shipment_photo', await f.readAsBytes(), 'image/jpeg');
      setState(() => _photos.add(key));
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final short = widget.s.heads - (int.tryParse(_heads.text) ?? widget.s.heads);
    return Panel(
      title: 'Checklist bago umalis',
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Muted('All four before the trip can start. These records decide a dispute later.'),
        const SizedBox(height: 12),
        TextField(
          controller: _heads,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(labelText: 'Bilang ng hayop (napagkasunduan ${widget.s.heads})', helperText: short > 0 ? '$short fewer than agreed. The farmer and buyer are told.' : null),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 12),
        TextField(controller: _permit, decoration: const InputDecoration(labelText: 'LGU shipping permit no.', hintText: 'SP-2026-…'), onChanged: (_) => setState(() {})),
        const SizedBox(height: 12),
        TextField(controller: _vet, decoration: const InputDecoration(labelText: 'Veterinary health certificate no.', hintText: 'VHC-…'), onChanged: (_) => setState(() {})),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: _uploading ? null : _addPhoto,
          icon: const Icon(Icons.photo_camera_outlined),
          label: Text(_uploading ? 'Uploading…' : _photos.isEmpty ? 'Litrato ng kargada' : '${_photos.length} photo(s) · add another'),
        ),
        const SizedBox(height: 14),
        FilledButton(
          onPressed: widget.busy || _uploading || !_complete
              ? null
              : () async {
                  final p = await widget.here();
                  widget.onStart({
                    'shipping_permit_no': _permit.text.trim(),
                    'vet_health_cert_no': _vet.text.trim(),
                    'head_count': int.parse(_heads.text),
                    'photo_keys': _photos,
                    'geo': p == null ? null : {'lat': p.latitude, 'lng': p.longitude},
                  });
                },
          child: Text(_complete ? 'Simulan ang biyahe' : 'Kumpletuhin ang checklist'),
        ),
        TextButton(
          onPressed: widget.busy
              ? null
              : () async {
                  final c = TextEditingController();
                  final r = await showDialog<String>(
                    context: context,
                    builder: (ctx) => AlertDialog(
                      title: const Text('Withdraw from this job'),
                      content: Column(mainAxisSize: MainAxisSize.min, children: [
                        const Note('The farmer and buyer read your reason, and the job reopens to other haulers.', warn: true),
                        TextField(controller: c, autofocus: true, decoration: const InputDecoration(labelText: 'Reason')),
                      ]),
                      actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Keep it')), FilledButton(onPressed: () => Navigator.pop(ctx, c.text.trim()), child: const Text('Withdraw'))],
                    ),
                  );
                  if (r != null && r.length >= 3) widget.onWithdraw(r);
                },
          child: const Text('Withdraw from this job', style: TextStyle(color: kWarn)),
        ),
      ]),
    );
  }
}

class _Handover extends StatefulWidget {
  const _Handover({required this.busy, required this.here, required this.onDone});
  final bool busy;
  final Future<Position?> Function() here;
  final void Function(Map<String, dynamic>) onDone;
  @override
  State<_Handover> createState() => _HandoverState();
}

class _HandoverState extends State<_Handover> {
  final _note = TextEditingController();
  String? _photo;
  bool _uploading = false;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Text('Dumating na', style: TextStyle(fontWeight: FontWeight.w600)),
      const SizedBox(height: 8),
      OutlinedButton.icon(
        onPressed: _uploading
            ? null
            : () async {
                final f = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1600, imageQuality: 85);
                if (f == null) return;
                setState(() => _uploading = true);
                try {
                  _photo = await ApiClient.instance.upload('shipment_photo', await f.readAsBytes(), 'image/jpeg');
                } catch (e) {
                  if (context.mounted) showError(context, e);
                } finally {
                  if (mounted) setState(() => _uploading = false);
                }
              },
        icon: const Icon(Icons.photo_camera_outlined),
        label: Text(_photo == null ? 'Litrato sa paghatid (optional)' : 'Photo taken, retake'),
      ),
      const SizedBox(height: 10),
      TextField(controller: _note, maxLength: 300, decoration: const InputDecoration(labelText: 'Note (optional)', counterText: '')),
      FilledButton(
        onPressed: widget.busy || _uploading
            ? null
            : () async {
                final p = await widget.here();
                widget.onDone({
                  'note': _note.text.trim().isEmpty ? null : _note.text.trim(),
                  'photo_keys': _photo == null ? <String>[] : [_photo!],
                  'geo': p == null ? null : {'lat': p.latitude, 'lng': p.longitude},
                });
              },
        child: const Text('Naihatid ko na sa buyer'),
      ),
    ]);
  }
}
