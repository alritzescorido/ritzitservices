import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../api/api.dart';
import '../api/client.dart';
import '../api/models.dart';
import '../ui.dart';

const _docLabel = {
  'gov_id': 'Government ID',
  'selfie_with_id': 'Selfie with ID',
  'business_permit': 'Business permit',
  'ltfrb_franchise': 'LTFRB franchise',
  'or_cr': 'Vehicle OR/CR',
  'coop_membership': 'Cooperative membership',
  'barangay_clearance': 'Barangay clearance',
};

/// Wireframe Profile: verification status, documents, payout account, language, sign out.
class MeScreen extends StatefulWidget {
  const MeScreen({super.key, required this.user, required this.onReload, required this.onSignOut});
  final User user;
  final Future<void> Function() onReload;
  final Future<void> Function() onSignOut;
  @override
  State<MeScreen> createState() => _MeScreenState();
}

class _MeScreenState extends State<MeScreen> {
  List<UserDocument> _docs = const [];
  PayoutAccount? _payout;
  HaulerProfile? _truck;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final docs = await Api.documents();
      final payout = widget.user.isFarmer ? await Api.payoutAccount() : null;
      final truck = widget.user.isHauler ? await Api.haulerProfile() : null;
      if (mounted) {
        setState(() {
          _docs = docs;
          _payout = payout;
          _truck = truck;
        });
      }
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _addDoc() async {
    final type = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => ListView(shrinkWrap: true, children: [for (final e in _docLabel.entries) ListTile(title: Text(e.value), onTap: () => Navigator.pop(ctx, e.key))]),
    );
    if (type == null) return;
    final f = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1600, imageQuality: 85);
    if (f == null) return;
    setState(() => _busy = true);
    try {
      final key = await ApiClient.instance.upload('user_document', await f.readAsBytes(), 'image/jpeg');
      await Api.registerDocument(type, key);
      await _load();
      if (mounted) showNote(context, 'Document sent for review.');
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _setPayout() async {
    final u = widget.user;
    String kind = 'gcash';
    final no = TextEditingController();
    final bank = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: const Text('Where I get paid'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            Muted('Released deposits go here. The account name must match your ID: ${u.fullName}. A one-peso test transfer verifies it.'),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: kind,
              items: const [DropdownMenuItem(value: 'gcash', child: Text('GCash')), DropdownMenuItem(value: 'bank', child: Text('Bank (InstaPay)'))],
              onChanged: (v) => set(() => kind = v ?? 'gcash'),
            ),
            const SizedBox(height: 10),
            TextField(controller: no, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: kind == 'gcash' ? 'GCash number' : 'Account number')),
            if (kind == 'bank') ...[const SizedBox(height: 10), TextField(controller: bank, decoration: const InputDecoration(labelText: 'Bank code, e.g. BPI'))],
          ]),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save and verify'))],
        ),
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      await Api.putPayoutAccount(kind, no.text.trim(), u.fullName, kind == 'bank' ? bank.text.trim() : null);
      await _load();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _setTruck() async {
    final t = _truck;
    final plate = TextEditingController(text: t?.vehiclePlate ?? '');
    final type = TextEditingController(text: t?.vehicleType ?? 'Elf truck');
    final cap = TextEditingController(text: '${t?.capacityHeads ?? 10}');
    final rate = TextEditingController(text: t?.ratePerHead ?? '');
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Aking trak'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Muted('Buyers see the plate and the capacity when you take a job. The rate only fills in your fee; you can change it per job.'),
          const SizedBox(height: 10),
          TextField(controller: plate, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'Plate', hintText: 'NEB 4521')),
          const SizedBox(height: 10),
          TextField(controller: type, decoration: const InputDecoration(labelText: 'Vehicle')),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: TextField(controller: cap, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Capacity, heads'))),
            const SizedBox(width: 10),
            Expanded(child: TextField(controller: rate, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Rate per head, ₱'))),
          ]),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save'))],
      ),
    );
    if (ok != true || plate.text.trim().length < 3) return;
    setState(() => _busy = true);
    try {
      await Api.putHaulerProfile({
        'vehicle_plate': plate.text.trim().toUpperCase(),
        'vehicle_type': type.text.trim().isEmpty ? 'truck' : type.text.trim(),
        'capacity_heads': int.tryParse(cap.text) ?? 1,
        'rate_per_head': rate.text.trim().isEmpty ? null : double.parse(rate.text).toStringAsFixed(2),
      });
      await _load();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Adding a role is what turns a farmer into a buyer too: the new tabs appear
  /// as soon as the token is rotated, which onReload does.
  Future<void> _addRole(String role) async {
    setState(() => _busy = true);
    try {
      await Api.addRole(role);
      await widget.onReload();
      await _load();
      if (mounted) showNote(context, 'Added. Your new tabs are at the bottom.');
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final u = widget.user;
    final p = _payout;
    final t = _truck;
    final missingRoles = const ['farmer', 'buyer', 'hauler'].where((r) => !u.roles.contains(r)).toList();
    return Scaffold(
      appBar: AppBar(title: Text(u.fullName)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Muted('${u.phoneMasked} · ${u.roles.where((r) => r != 'admin').join(', ')}', size: 14),
          const SizedBox(height: 10),
          Panel(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [const Text('Verification', style: TextStyle(fontWeight: FontWeight.w600)), StatusPill(u.verification, tone: u.verified ? 'ok' : u.verification == 'pending' ? 'info' : 'warn')]),
              if (u.verificationNotes != null) Text(u.verificationNotes!, style: const TextStyle(color: kWarn, fontSize: 13)),
              Muted(u.verified ? 'Verified.' : 'An admin checks your documents, usually within 2 working days.'),
              TextButton(onPressed: () => widget.onReload().then((_) => _load()), child: const Text('Refresh status')),
            ]),
          ),
          Panel(
            title: 'Documents',
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              for (final d in _docs)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(_docLabel[d.docType] ?? d.docType, style: const TextStyle(fontSize: 14)),
                        Muted(when(d.uploadedAt)),
                        if (d.notes != null) Text(d.notes!, style: const TextStyle(color: kWarn, fontSize: 13)),
                      ]),
                    ),
                    StatusPill(d.status, tone: d.status == 'verified' ? 'ok' : d.status == 'pending' ? 'info' : 'warn'),
                  ]),
                ),
              if (_docs.isEmpty) const Muted('No documents yet.'),
              const SizedBox(height: 6),
              OutlinedButton.icon(onPressed: _busy ? null : _addDoc, icon: const Icon(Icons.photo_camera_outlined), label: const Text('Add a document')),
            ]),
          ),
          if (u.isFarmer)
            Panel(
              title: 'Where I get paid',
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                if (p != null) Row(children: [Expanded(child: Text('${p.kind == 'gcash' ? 'GCash' : 'Bank'} ${p.masked}')), StatusPill(p.verified ? 'verified' : 'unverified', tone: p.verified ? 'ok' : 'warn')]),
                if (p == null) const Muted('Released deposits are sent here. Add your GCash number or bank account.'),
                const SizedBox(height: 6),
                OutlinedButton(onPressed: _busy ? null : _setPayout, child: Text(p == null ? 'Add payout account' : 'Change')),
              ]),
            ),
          if (u.isHauler)
            Panel(
              title: 'Aking trak',
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                if (t != null) Text('${t.vehicleType} ${t.vehiclePlate} · up to ${t.capacityHeads} heads${t.ratePerHead != null ? ' · ${money(t.ratePerHead)} per head' : ''}', style: const TextStyle(fontSize: 14)),
                if (t == null) const Muted('Add your truck before you can take a hauling job.'),
                const SizedBox(height: 6),
                OutlinedButton(onPressed: _busy ? null : _setTruck, child: Text(t == null ? 'Add my truck' : 'Change')),
              ]),
            ),
          if (missingRoles.isNotEmpty)
            Panel(
              title: 'Ako rin ay',
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const Muted('You can do more than one thing here. Adding a role keeps everything you already have.'),
                const SizedBox(height: 6),
                for (final r in missingRoles)
                  OutlinedButton(
                    onPressed: _busy ? null : () => _addRole(r),
                    child: Text(r == 'farmer' ? 'Farmer / magsasaka' : r == 'buyer' ? 'Buyer / viajero' : 'Hauler / may truck'),
                  ),
              ]),
            ),
          Panel(
            title: 'Language',
            child: DropdownButtonFormField<String>(
              initialValue: u.preferredLang,
              items: const [
                DropdownMenuItem(value: 'fil', child: Text('Filipino')),
                DropdownMenuItem(value: 'en', child: Text('English')),
                DropdownMenuItem(value: 'ilo', child: Text('Ilokano')),
                DropdownMenuItem(value: 'ceb', child: Text('Cebuano')),
                DropdownMenuItem(value: 'hil', child: Text('Hiligaynon')),
              ],
              onChanged: (v) async {
                if (v == null) return;
                try {
                  await Api.updateMe(lang: v);
                  await widget.onReload();
                } catch (e) {
                  if (context.mounted) showError(context, e);
                }
              },
            ),
          ),
          const SizedBox(height: 8),
          OutlinedButton(onPressed: widget.onSignOut, child: const Text('Sign out')),
          const SizedBox(height: 8),
          Center(child: Muted('API: ${ApiClient.instance.baseUrl}')),
        ],
      ),
    );
  }
}
