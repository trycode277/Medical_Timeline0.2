async def make_event(client, patient, **over):
    body = {"patient_id": str(patient.id), "event_type": "visit", "event_date": "2024-03-04",
            "title": "Clinic visit", "description": "Routine follow-up.", "provider": "Dr. Rivera", **over}
    r = await client.post("/api/events", json=body)
    assert r.status_code == 201
    return r.json()


async def test_patch_recategorizes_event(client, patient):
    ev = await make_event(client, patient)
    r = await client.patch(f"/api/events/{ev['id']}", json={"event_type": "diagnosis"})
    assert r.status_code == 200
    assert r.json()["event_type"] == "diagnosis" and r.json()["updated_at"] is not None


async def test_patch_rejects_unknown_category(client, patient):
    ev = await make_event(client, patient)
    assert (await client.patch(f"/api/events/{ev['id']}", json={"event_type": "surgery"})).status_code == 422


async def test_patch_can_clear_optional_fields_but_not_required_ones(client, patient):
    ev = await make_event(client, patient)
    r = await client.patch(f"/api/events/{ev['id']}", json={"provider": None, "description": None})
    body = r.json()
    assert body["provider"] is None
    assert body["description"] == "Routine follow-up."  # required field ignored when null


async def test_delete_event(client, patient):
    ev = await make_event(client, patient)
    assert (await client.delete(f"/api/events/{ev['id']}")).status_code == 204
    assert (await client.get(f"/api/events/{ev['id']}")).status_code == 404


async def test_filter_by_category(client, patient):
    await make_event(client, patient)
    await make_event(client, patient, event_type="test", title="Blood test")
    r = await client.get("/api/events", params={"patient_id": str(patient.id), "event_type": "test"})
    assert r.json()["total"] == 1 and r.json()["items"][0]["title"] == "Blood test"


async def test_search_treats_percent_literally(client, patient):
    await make_event(client, patient, description="Dose reduced by 50% after review.")
    await make_event(client, patient, description="Dose reduced by 500 mg after review.")
    r = await client.get("/api/events", params={"patient_id": str(patient.id), "q": "50%"})
    assert r.json()["total"] == 1
