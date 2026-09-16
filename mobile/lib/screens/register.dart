import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../api/api.dart';
import '../api/client.dart';
import '../api/models.dart';
import '../ui.dart';
import 'widgets/location_picker.dart';

/// Wireframes RegisterFarmer, RegisterBuyer and RegisterHauler on one screen:
/// the role decides which fields and which documents appear, matching
/// web-app/src/pages/Register.tsx.
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key, required this.user, required this.onDone});
  final User user;
  final Future<void> Function() onDone;
  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _Doc {
  const _Doc(this.type, this.label, this.required);
  final String type, label;
  final bool required;
}

const _docsByRole = <String, List<_Doc>>{
  'farmer': [_Doc('barangay_clearance', 'Barangay clearance', true), _Doc('gov_id', 'Government ID', false)],
  'buyer': [_Doc('gov_id', 'Government ID', true), _Doc('selfie_with_id', 'Selfie holding the ID', true), _Doc('business_permit', "Business or mayor's permit", false)],
  'hauler': [_Doc('gov_id', 'Government ID', true), _Doc('or_cr', 'Vehicle OR/CR', true), _Doc('ltfrb_franchise', 'LTFRB franchise', false)],
};

const _roleTitle = {'farmer': 'Farmer / magsasaka', 'buyer': 'Buyer / viajero, trader', 'hauler': 'Hauler / may truck'};
const _roleBlurb = {
  'farmer': 'List animals, see offers, get paid.',
  'buyer': 'Browse listings, make offers, book hauling.',
  'hauler': 'Take hauling jobs, run the pickup checklist.',
};

class _RegisterScreenState extends State<RegisterScreen> {
  late final _name = TextEditingController(text: widget.user.fullName);
  final _farm = TextEditingController();
  final _plate = TextEditingController();
  final _truck = TextEditingController(text: 'Elf truck');
  final _capacity = TextEditingController(text: '10');
  String _lang = 'fil';
  late String _role = widget.user.tradeRoles.isEmpty ? 'farmer' : widget.user.tradeRoles.first;
  String _farmType = 'backyard';
  Location? _barangay;
  final Map<String, XFile> _files = {};
  bool _busy = false;
  // An admin can switch the ID requirement off from the console.
  bool _docsRequired = true;

  @override
  void initState() {
    super.initState();
    Api.requireDocuments().then((v) {
      if (mounted) setState(() => _docsRequired = v);
    });
  }

  Future<void> _pick(String docType) async {
    final f = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1600, imageQuality: 85);
    if (f != null) setState(() => _files[docType] = f);
  }

  bool get _canSubmit => _name.text.trim().length >= 2 && (_role != 'farmer' || _barangay != null) && (_role != 'hauler' || _plate.text.trim().length >= 3);

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      await Api.updateMe(fullName: _name.text.trim(), lang: _lang);
      if (!widget.user.roles.contains(_role)) {
        await Api.addRole(_role);
        // The API reads roles from the token's claims, not the database, so the
        // token must be rotated before the first call that needs the new role.
        await ApiClient.instance.refresh();
      }
      if (_role == 'farmer') {
        await Api.createFarm(_farm.text.trim().isEmpty ? '${_name.text.trim()} farm' : _farm.text.trim(), _barangay!.code, _farmType);
      }
      if (_role == 'hauler') {
        await Api.putHaulerProfile({
          'vehicle_plate': _plate.text.trim().toUpperCase(),
          'vehicle_type': _truck.text.trim().isEmpty ? 'truck' : _truck.text.trim(),
          'capacity_heads': int.tryParse(_capacity.text) ?? 1,
        });
      }
      for (final d in _docsByRole[_role]!) {
        final f = _files[d.type];
        if (f != null) await Api.registerDocument(d.type, await ApiClient.instance.upload('user_document', await f.readAsBytes(), 'image/jpeg'));
      }
      await widget.onDone();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final docs = _docsByRole[_role]!;
    final missingRequired = _docsRequired && docs.any((d) => d.required && !_files.containsKey(d.type));
    return Scaffold(
      appBar: AppBar(title: const Text('Tell us who you are')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Muted('Verification usually takes 2 working days. You can see prices right away.'),
          const SizedBox(height: 14),
          TextField(controller: _name, decoration: const InputDecoration(labelText: 'Full name (as on your ID)'), autofillHints: const [AutofillHints.name], onChanged: (_) => setState(() {})),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _lang,
            decoration: const InputDecoration(labelText: 'Language'),
            items: const [
              DropdownMenuItem(value: 'fil', child: Text('Filipino')),
              DropdownMenuItem(value: 'en', child: Text('English')),
              DropdownMenuItem(value: 'ilo', child: Text('Ilokano')),
              DropdownMenuItem(value: 'ceb', child: Text('Cebuano')),
              DropdownMenuItem(value: 'hil', child: Text('Hiligaynon')),
            ],
            onChanged: (v) => setState(() => _lang = v ?? 'fil'),
          ),
          const SectionTitle('Ako ay'),
          for (final r in const ['farmer', 'buyer', 'hauler'])
            Card(
              child: ListTile(
                onTap: () => setState(() => _role = r),
                leading: Icon(_role == r ? Icons.radio_button_checked : Icons.radio_button_unchecked, color: _role == r ? kAccent : null),
                title: Text(_roleTitle[r]!, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                subtitle: Muted(_roleBlurb[r]!),
              ),
            ),
          if (_role == 'farmer') ...[
            const SectionTitle('Your farm'),
            TextField(controller: _farm, decoration: const InputDecoration(labelText: 'Farm name', hintText: 'e.g. Maligaya backyard')),
            const SizedBox(height: 12),
            LocationPicker(level: 'barangay', label: 'Barangay', value: _barangay, onChanged: (l) => setState(() => _barangay = l)),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _farmType,
              decoration: const InputDecoration(labelText: 'Type'),
              items: const [
                DropdownMenuItem(value: 'backyard', child: Text('Backyard')),
                DropdownMenuItem(value: 'commercial', child: Text('Commercial')),
                DropdownMenuItem(value: 'cooperative', child: Text('Cooperative')),
              ],
              onChanged: (v) => setState(() => _farmType = v ?? 'backyard'),
            ),
          ],
          if (_role == 'buyer') const Padding(padding: EdgeInsets.only(top: 6), child: Muted('You choose where to buy each time you make an offer, so there is nothing else to set up now.')),
          if (_role == 'hauler') ...[
            const SectionTitle('Your truck'),
            Row(children: [
              Expanded(
                child: TextField(
                  controller: _plate,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(labelText: 'Plate', hintText: 'NEB 4521'),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: _capacity, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Capacity, heads'))),
            ]),
            const SizedBox(height: 12),
            TextField(controller: _truck, decoration: const InputDecoration(labelText: 'Vehicle')),
          ],
          const SectionTitle('Documents'),
          for (final d in docs) _docRow(d),
          const SizedBox(height: 8),
          if (!_docsRequired)
            const Muted('Documents are optional right now. An admin can still verify you without one.')
          else if (missingRequired)
            const Muted('You can add the required documents later under Ako, but verification starts only when they are in.'),
          const SizedBox(height: 16),
          FilledButton(onPressed: _busy || !_canSubmit ? null : _submit, child: Text(_busy ? 'Saving…' : 'Finish')),
        ],
      ),
    );
  }

  Widget _docRow(_Doc d) {
    final f = _files[d.type];
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text('${d.label}${d.required && _docsRequired ? '' : ' (optional)'}', style: const TextStyle(fontSize: 14)),
      subtitle: f == null ? null : Muted(f.name),
      trailing: OutlinedButton.icon(onPressed: () => _pick(d.type), icon: const Icon(Icons.photo_camera_outlined), label: Text(f == null ? 'Photo' : 'Retake')),
    );
  }
}
