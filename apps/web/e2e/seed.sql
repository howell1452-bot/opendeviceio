-- E2E fixtures: one unclaimed brand with two machine drafts. The 0010 trigger
-- creates its brand profile (slug acme-devices) and 0008c its revisions.
insert into public.registry (id, kind, manufacturer, model, category, validation_status, odio_version, port_count, document)
values
  ('acme-devices/a1', 'device', 'Acme Devices', 'A1', 'av/audio/dsp', 'draft', '0.1.0', 0,
   '{"odioVersion":"0.1.0","id":"acme-devices/a1","device":{"manufacturer":"Acme Devices","model":"A1","category":"av/audio/dsp"},"ports":[],"provenance":{"method":"llm-extraction","validation":{"status":"draft"}}}'),
  ('acme-devices/a2', 'device', 'Acme Devices', 'A2', 'av/audio/dsp', 'draft', '0.1.0', 0,
   '{"odioVersion":"0.1.0","id":"acme-devices/a2","device":{"manufacturer":"Acme Devices","model":"A2","category":"av/audio/dsp"},"ports":[],"provenance":{"method":"llm-extraction","validation":{"status":"draft"}}}')
on conflict (id) do nothing;

-- SEO fixtures (e2e/seo.spec.ts): a second brand, untouched by the claim
-- spec, with one record that was renamed (old id -> new id, as 0012 does).
insert into public.registry (id, kind, manufacturer, model, category, validation_status, odio_version, port_count, document)
values
  ('example-audio/x1', 'device', 'Example Audio', 'X1', 'av/audio/dsp', 'draft', '0.1.0', 0,
   '{"odioVersion":"0.1.0","id":"example-audio/x1","device":{"manufacturer":"Example Audio","model":"X1","category":"av/audio/dsp"},"ports":[],"provenance":{"method":"llm-extraction","validation":{"status":"draft"}}}')
on conflict (id) do nothing;
insert into public.record_redirects (old_id, new_id)
values ('example-audio-old/x1', 'example-audio/x1')
on conflict (old_id) do nothing;
