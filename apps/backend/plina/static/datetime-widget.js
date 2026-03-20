class DatetimeWidget {
    constructor(lona_window) {
        this.lona_window = lona_window;
    }

    setFromData() {
        this.root_node.children[1].value = this.data['date_str'];
        this.root_node.children[2].value = this.data['time_str'];
        this.root_node.children[1].disabled = !this.data['is_set'];
        this.root_node.children[2].disabled = !this.data['is_set'];
    }

    noDefault(ev) {
        ev.preventDefault();
        ev.stopPropagation();
    }

    changeHandler(ev) {
        const date = this.root_node.children[1].valueAsDate;
        const time = this.root_node.children[2].valueAsDate;
        this.lona_window.fire_input_event(this.root_node, 'change', {
            year: date.getUTCFullYear(),
            month: date.getUTCMonth()+1,
            day: date.getUTCDate(),
            hour: time.getUTCHours(),
            minute: time.getUTCMinutes()
        });
    }

    // gets called on initial setup
    setup() {
        this.setFromData();
        this.root_node.children[1].addEventListener("click",
            function (ev) {ev.stopPropagation();});
        this.root_node.children[2].addEventListener("click",
            function (ev) {ev.stopPropagation();});
        this.root_node.children[1].addEventListener("change",
            this.changeHandler.bind(this));
        this.root_node.children[2].addEventListener("change",
            this.changeHandler.bind(this));
    }

    // gets called every time the data gets updated
    data_updated() {
        this.root_node.children[1].addEventListener("change",
            this.noDefault.bind(this));
        this.root_node.children[2].addEventListener("change",
            this.noDefault.bind(this));
        this.setFromData();
        this.root_node.children[1].removeEventListener("change",
            this.noDefault.bind(this));
        this.root_node.children[2].removeEventListener("change",
            this.noDefault.bind(this));
    }

    // gets called when the widget gets destroyed
    deconstruct() {

    }
}

Lona.register_widget_class('DatetimeWidget', DatetimeWidget);