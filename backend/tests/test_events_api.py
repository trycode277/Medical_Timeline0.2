from app.models.patient import Patient


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


async def test_list_events_requires_authentication(client):
    response = await client.get("/api/events")
    assert response.status_code == 401


async def test_filter_by_category(client, registered_patient):
    patient, token = registered_patient
    await make_event(client, patient)
    await make_event(client, patient, event_type="test", title="Blood test")
    r = await client.get(
        "/api/events",
        headers={"Authorization": f"Bearer {token}"},
        params={"event_type": "test"},
    )
    assert r.json()["total"] == 1 and r.json()["items"][0]["title"] == "Blood test"


async def test_search_treats_percent_literally(client, registered_patient):
    patient, token = registered_patient
    await make_event(client, patient, description="Dose reduced by 50% after review.")
    await make_event(client, patient, description="Dose reduced by 500 mg after review.")
    r = await client.get(
        "/api/events",
        headers={"Authorization": f"Bearer {token}"},
        params={"q": "50%"},
    )
    assert r.json()["total"] == 1


async def test_list_events_is_scoped_to_authenticated_patient(
    client, session_factory, registered_patient
):
    own_patient, token = registered_patient
    own_event = await make_event(client, own_patient, title="My visit")

    async with session_factory() as session:
        other_patient = Patient(first_name="Other", last_name="Patient")
        session.add(other_patient)
        await session.commit()
        await session.refresh(other_patient)

    await make_event(client, other_patient, title="Another patient's visit")
    response = await client.get(
        "/api/events",
        headers={"Authorization": f"Bearer {token}"},
        params={"patient_id": str(other_patient.id)},
    )

    body = response.json()
    assert response.status_code == 200
    assert body["total"] == 1
    assert [event["id"] for event in body["items"]] == [own_event["id"]]
