def set_priority_by_order(model_class, id_list):
    all_model_objects = model_class.objects.order_by('-priority').all()
    ordered_objects = []
    for id_no, ordered_id in enumerate(id_list):
        for model_obj in all_model_objects:
            if str(model_obj.pk) == ordered_id:
                model_obj.priority = len(all_model_objects) - id_no * 2
                model_obj.save()
                ordered_objects.append(model_obj)
    if len(id_list) != len(ordered_objects):
        ordered_objects = model_class.objects.order_by('-priority').all()
    return ordered_objects
