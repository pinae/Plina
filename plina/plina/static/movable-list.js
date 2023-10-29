class MovableList {
    constructor(lona_window) {
        this.lona_window = lona_window;
    }

    dragendHandler(ev) {
        ev.preventDefault();
        ev.target.style.opacity = "100%";
    }

    dragstartHandler(ev) {
        ev.stopPropagation();
        ev.dataTransfer.setData("text/plain", ev.target.id);
        ev.target.style.opacity = "25%";
        ev.target.removeEventListener("dragend", this.dragendHandler.bind(this));
        ev.target.addEventListener("dragend", this.dragendHandler.bind(this));
    }

    dragoverHandler(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const dragItemID = ev.dataTransfer.getData("text/plain");
        if (!this.data['ids'].includes(dragItemID)) {
            return;
        }
        ev.dataTransfer.dropEffect = "move";
        let nodes = this.root_node.children;
        let pos = 0;
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].offsetTop <= ev.pageY) pos = i;
            else break;
        }
        if (pos < nodes.length - 1) {
            this.root_node.insertBefore(document.getElementById(dragItemID), nodes[pos]);
        } else {
            this.root_node.appendChild(document.getElementById(dragItemID));
        }
    }

    dropHandler(ev) {
        ev.preventDefault();
        let ids = "";
        for (let i = 0; i < this.root_node.children.length; i++)
            ids += ',' + this.root_node.children[i].id;
        ids = ids.slice(1, ids.length)
        this.lona_window.fire_input_event(this.root_node, 'list_order', ids);
    }

    // gets called on initial setup
    setup() {
        this.root_node.addEventListener("dragover", this.dragoverHandler.bind(this));
        for (let i = 0; i < this.root_node.children.length; i++) {
            let item = this.root_node.children[i];
            item.draggable = true;
            item.addEventListener("dragstart", this.dragstartHandler.bind(this));
            item.addEventListener("drop", this.dropHandler.bind(this));
        }
    }

    // gets called every time the data gets updated
    data_updated() {
        for (let i = 0; i < this.root_node.children.length; i++) {
            let item = this.root_node.children[i];
            item.draggable = true;
            item.removeEventListener("dragstart", this.dragstartHandler.bind(this));
            item.addEventListener("dragstart", this.dragstartHandler.bind(this));
            item.removeEventListener("drop", this.dropHandler.bind(this));
            item.addEventListener("drop", this.dropHandler.bind(this));
        }
    }

    // gets called when the widget gets destroyed
    deconstruct() {

    }
}

Lona.register_widget_class('MovableList', MovableList);
