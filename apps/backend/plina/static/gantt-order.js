class GanttOrder {
    constructor(lona_window) {
        this.lona_window = lona_window;
        this.indent = 27;
    }

    mouseDownHandler(ev) {
        this.clickpos.x = ev.clientX;
        this.clickpos.y = ev.clientY;
        this.dragNode = ev.target;
        while (this.dragNode.id === undefined || this.dragNode.id.length < 36)
            this.dragNode = this.dragNode.parentNode;
        this.dragNodeId = this.dragNode.id;
        this.dragNode.style.opacity = '50%';
        this.dragNode.style.position = 'relative';
        this.dragNode.style.left = 0 + 'px';
        this.dragNode.style.top = 0 + 'px';
        this.dragging = true;
        this.lona_window.fire_input_event(this.root_node, 'drag_start', this.dragNodeId);
    }

    mouseMoveHandler(ev) {
        if (this.dragging) {
            let dx = ev.clientX - this.clickpos.x;
            let dy = ev.clientY - this.clickpos.y;
            this.dragNode.style.left = dx + 'px';
            this.dragNode.style.top = dy + 'px';
            if (dx < -this.indent/2 || dx > this.indent/2 || dy < -this.dragNode.clientHeight/2 || dy > this.dragNode.clientHeight/2) {
                let event_data = {
                    x: Math.floor((this.indent/2 + dx) / this.indent),
                    y: Math.floor((this.dragNode.clientHeight/2 + dy) / this.dragNode.clientHeight),
                    id: this.dragNode.id
                };
                this.clickpos.x += event_data.x * this.indent;
                this.clickpos.y += event_data.y * this.dragNode.clientHeight;
                this.lona_window.fire_input_event(this.root_node, 'drag_position', event_data);
            }
        }
    }

    mouseUpHandler(ev) {
        if (this.dragNode !== undefined) {
            this.dragNode.style.opacity = 'inherit';
            this.dragNode.style.position = 'static';
        }
        this.dragging = false;
        this.dragNode = undefined;
        this.dragNodeId = undefined;
    }

    setup() {
        this.dragging = false;
        this.clickpos = {x: 0, y: 0};
        this.dragNode = undefined;
        this.dragNodeId = undefined;
        this.root_node.addEventListener("mousemove", this.mouseMoveHandler.bind(this));
        this.root_node.addEventListener("mouseup", this.mouseUpHandler.bind(this));
        //this.root_node.addEventListener("mouseout", this.mouseUpHandler.bind(this));
        this.data_updated();
    }

    data_updated() {
        for (let i = 0; i < this.root_node.childNodes.length; i++) {
            let child = this.root_node.childNodes[i];
            child.removeEventListener("mousedown", this.mouseDownHandler.bind(this));
            child.addEventListener("mousedown", this.mouseDownHandler.bind(this));
            if (this.dragging && child.id === this.dragNodeId) {
                this.dragNode = child;
                this.dragNode.style.opacity = '50%';
                this.dragNode.style.position = 'relative';
                this.dragNode.style.left = 0 + 'px';
                this.dragNode.style.top = 0 + 'px';
            }
            for (let j = 0; j < this.data.items.length; j++) {
                if (this.data.items[j].id === child.id) {
                    child.style.marginLeft = this.indent * this.data.items[j].order + "px";
                }
            }
        }
    }
}

Lona.register_widget_class('GanttOrder', GanttOrder);